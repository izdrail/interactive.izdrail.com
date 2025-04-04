import { useCallback, useContext, useEffect, useState, useMemo } from "react";
import VrmViewer from "@/components/vrmViewer";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import {
  Message,
  textsToScreenplay,
  Screenplay,
} from "@/features/messages/messages";
import { speakCharacter } from "@/features/messages/speakCharacter";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { SYSTEM_PROMPT } from "@/features/constants/systemPromptConstants";
import { KoeiroParam, DEFAULT_PARAM } from "@/features/constants/koeiroParam";
import { getChatResponseStream } from "@/features/chat/openAiChat";
import { Menu } from "@/components/menu";
import { GitHubLink } from "@/components/githubLink";
import { Meta } from "@/components/meta";

// Constants
const LOCAL_STORAGE_KEY = "chatVRMParams";

export default function Home() {
  const { viewer } = useContext(ViewerContext);

  // State management
  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT);
  const [openAiKey, setOpenAiKey] = useState("");
  const [koeiromapKey, setKoeiromapKey] = useState("");
  const [koeiroParam, setKoeiroParam] = useState<KoeiroParam>(DEFAULT_PARAM);
  const [chatProcessing, setChatProcessing] = useState(false);
  const [chatLog, setChatLog] = useState<Message[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [pendingAnimations, setPendingAnimations] = useState<Screenplay[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);

  // Load saved parameters from local storage when the component mounts
  useEffect(() => {
    const savedParams = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    
    if (savedParams) {
      try {
        const params = JSON.parse(savedParams);
        setSystemPrompt(params.systemPrompt ?? SYSTEM_PROMPT);
        setKoeiroParam(params.koeiroParam ?? DEFAULT_PARAM);
        setChatLog(params.chatLog ?? []);
      } catch (error) {
        console.error("Failed to parse saved parameters:", error);
      }
    }
  }, []);

  // Save parameters to local storage whenever they change
  useEffect(() => {
    const saveToLocalStorage = () => {
      try {
        window.localStorage.setItem(
          LOCAL_STORAGE_KEY,
          JSON.stringify({ systemPrompt, koeiroParam, chatLog })
        );
      } catch (error) {
        console.error("Failed to save parameters:", error);
      }
    };
    
    requestAnimationFrame(saveToLocalStorage);
  }, [systemPrompt, koeiroParam, chatLog]);

  // Animation queue processor effect
  useEffect(() => {
    const processAnimationQueue = async () => {
      if (pendingAnimations.length > 0 && !isAnimating && viewer) {
        setIsAnimating(true);
        const nextAnimation = pendingAnimations[0];
        
        try {
          // Only animate the VRM model without audio
          await animateVrmOnly(nextAnimation);
        } catch (error) {
          console.error("Animation error:", error);
        }
        
        // Remove the processed animation from the queue
        setPendingAnimations(current => current.slice(1));
        setIsAnimating(false);
      }
    };

    processAnimationQueue();
  }, [pendingAnimations, isAnimating, viewer]);
  
  // Prepare messages for Chat GPT with memoization
  const getMessagesForAPI = useMemo(() => (userMessages: Message[]) => {
    return [
      { role: "system", content: systemPrompt },
      ...userMessages
    ];
  }, [systemPrompt]);

  // Update a specific message in the chat log
  const handleChangeChatLog = useCallback((targetIndex: number, text: string) => {
    setChatLog(prevChatLog => 
      prevChatLog.map((v: Message, i) => 
        i === targetIndex ? { ...v, content: text } : v
      )
    );
  }, []);

  // Reset handlers
  const handleResetChatLog = useCallback(() => setChatLog([]), []);
  const handleResetSystemPrompt = useCallback(() => setSystemPrompt(SYSTEM_PROMPT), []);

  /**
   * Animate VRM model without audio playback
   */
  const animateVrmOnly = useCallback(async (screenplay: Screenplay) => {
    if (!viewer) return;
    
    return new Promise<void>((resolve) => {
      // Use speakCharacter but pass an empty koeiromapKey to skip audio generation
      // The model will still animate based on the text timing
      speakCharacter(
        screenplay, 
        viewer, 
        "", // Empty koeiromapKey to skip audio generation
        () => {}, // onStart
        () => resolve() // onEnd
      );
    });
  }, [viewer]);

  /**
   * Queue an animation for the VRM model
   */
  const queueAnimation = useCallback((screenplay: Screenplay) => {
    setPendingAnimations(current => [...current, screenplay]);
  }, []);

  /**
   * Process a sentence from the AI response
   */
  const processSentence = useCallback((
    sentence: string, 
    tag: string, 
    koeiroParam: KoeiroParam
  ) => {
    // Skip unpronounceable or unnecessary strings
    if (!sentence.replace(/^[\s\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉『】）］」\}\)\]]+$/g, "")) {
      return null;
    }

    const aiText = `${tag} ${sentence}`;
    const aiTalks = textsToScreenplay([aiText], koeiroParam);
    
    return { aiText, aiTalks };
  }, []);

  /**
   * Handle conversation with the assistant
   */
  const handleSendChat = useCallback(async (text: string) => {
    if (!text?.trim()) return;

    setChatProcessing(true);
    setAssistantMessage(""); // Clear previous assistant message
    
    // Add the user's message to the chat log
    const messageLog: Message[] = [
      ...chatLog,
      { role: "user", content: text }
    ];
    setChatLog(messageLog);

    try {
      // Get the response stream from Chat GPT
      const stream = await getChatResponseStream(
        getMessagesForAPI(messageLog), 
        openAiKey
      );
      
      if (!stream) {
        throw new Error("Failed to get response stream");
      }

      const reader = stream.getReader();
      let receivedMessage = "";
      let completeResponse = "";
      let tag = "";
      const sentences = new Array<string>();
      const animationsToQueue = [];
      
      // Create a new assistant message placeholder in the chat log
      setChatLog(prev => [
        ...prev,
        { role: "assistant", content: "" }
      ]);
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        receivedMessage += value;
        completeResponse += value;
        
        // Update the assistant message immediately for display
        setAssistantMessage(completeResponse);
        
        // Update the latest message in the chat log
        setChatLog(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { 
            role: "assistant", 
            content: completeResponse 
          };
          return updated;
        });

        // Extract tag from the beginning of the response
        const tagMatch = receivedMessage.match(/^\[(.*?)\]/);
        if (tagMatch && tagMatch[0]) {
          tag = tagMatch[0];
          receivedMessage = receivedMessage.slice(tag.length);
        }

        // Process text sentence by sentence
        const sentenceMatch = receivedMessage.match(/^(.+[。．！？\n]|.{10,}[、,])/);
        if (sentenceMatch && sentenceMatch[0]) {
          const sentence = sentenceMatch[0];
          sentences.push(sentence);
          receivedMessage = receivedMessage.slice(sentence.length).trimStart();

          const processed = processSentence(sentence, tag, koeiroParam);
          if (processed) {
            const { aiTalks } = processed;
            // Add to animation queue instead of playing immediately
            animationsToQueue.push(aiTalks[0]);
          }
        }
      }
      
      // After displaying the full message, queue all animations
      animationsToQueue.forEach(animation => queueAnimation(animation));
      
    } catch (error) {
      console.error("Chat processing error:", error);
    } finally {
      setChatProcessing(false);
    }
  }, [
    chatLog, 
    openAiKey, 
    koeiroParam, 
    getMessagesForAPI, 
    processSentence, 
    queueAnimation
  ]);

  return (
    <div className="font-M_PLUS_2">
      <Meta />
      <VrmViewer />
      <MessageInputContainer
        isChatProcessing={chatProcessing}
        onChatProcessStart={handleSendChat}
      />
      <Menu
        openAiKey={openAiKey}
        systemPrompt={systemPrompt}
        chatLog={chatLog}
        koeiroParam={koeiroParam}
        assistantMessage={assistantMessage}
        koeiromapKey={koeiromapKey}
        onChangeAiKey={setOpenAiKey}
        onChangeSystemPrompt={setSystemPrompt}
        onChangeChatLog={handleChangeChatLog}
        onChangeKoeiromapParam={setKoeiroParam}
        handleClickResetChatLog={handleResetChatLog}
        handleClickResetSystemPrompt={handleResetSystemPrompt}
        onChangeKoeiromapKey={setKoeiromapKey}
      />
      <GitHubLink />
    </div>
  );
}