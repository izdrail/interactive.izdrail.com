import { wait } from "@/utils/wait";
import { synthesizeVoiceApi } from "./synthesizeVoice";
import { Viewer } from "../vrmViewer/viewer";
import { Screenplay } from "./messages";
import { Talk } from "./messages";

const createSpeakCharacter = () => {
  let lastTime = 0;
  let prevFetchPromise: Promise<unknown> = Promise.resolve();
  let prevSpeakPromise: Promise<unknown> = Promise.resolve();

  return (
    screenplay: Screenplay,
    viewer: Viewer,
    koeiroApiKey: string,
    onStart?: () => void,
    onComplete?: () => void
  ) => {
    const fetchPromise = prevFetchPromise.then(async () => {
      const now = Date.now();
      if (now - lastTime < 1000) {
        await wait(1000 - (now - lastTime));
      }

      // buffer 2 

      const buffer = await fetchAudio(screenplay.talk, koeiroApiKey).catch(
        () => null
      );
      lastTime = Date.now();
      return buffer;
    });

    prevFetchPromise = fetchPromise;
    prevSpeakPromise = Promise.all([fetchPromise, prevSpeakPromise]).then(
      ([audioBuffer]) => {
        onStart?.();
        if (!audioBuffer) {
          return;
        }
        return viewer.model?.speak(audioBuffer, screenplay);
      }
    );
    prevSpeakPromise.then(() => {
      onComplete?.();
    });
  };
};


const createSecondSpeakCharacter = () => {
  let lastTime = 0;
  let prevFetchPromise: Promise<unknown> = Promise.resolve();
  let prevSpeakPromise: Promise<unknown> = Promise.resolve();

  return (
    screenplay: Screenplay,
    viewer: Viewer,
    koeiroApiKey: string,
    onStart?: () => void,
    onComplete?: () => void
  ) => {
    const fetchPromise = prevFetchPromise.then(async () => {
      const now = Date.now();
      if (now - lastTime < 1000) {
        await wait(1000 - (now - lastTime));
      }

      // buffer 2 

      const buffer = await fetchAudio(screenplay.talk, koeiroApiKey).catch(
        () => null
      );
      lastTime = Date.now();
      return buffer;
    });

    prevFetchPromise = fetchPromise;
    prevSpeakPromise = Promise.all([fetchPromise, prevSpeakPromise]).then(
      ([audioBuffer]) => {
        onStart?.();
        if (!audioBuffer) {
          return;
        }
        return viewer.model?.speak(audioBuffer, screenplay);
      }
    );
    prevSpeakPromise.then(() => {
      onComplete?.();
    });
  };
};


// You can also create a version that integrates with the queue system
export const queueLocalAudio = (createSpeakCharacter: () => any) => {
  let prevPlayPromise: Promise<unknown> = Promise.resolve();
  
  return (
    localFilePath: string,
    viewer: Viewer,
    screenplay: Screenplay,
    onStart?: () => void,
    onComplete?: () => void
  ) => {
    // Queue this playback after previous audio completes
    prevPlayPromise = Promise.all([
      playLocalAudio(localFilePath, viewer, screenplay, onStart),
      prevPlayPromise
    ]).then(() => {
      onComplete?.();
    });
    
    return prevPlayPromise;
  };
};


// New function to play local audio files
export const playLocalAudio = async (
  localFilePath: string,
  viewer: Viewer,
  screenplay: Screenplay,
  onStart?: () => void,
  onComplete?: () => void
): Promise<void> => {
  try {
    // Load the local audio file
    const response = await fetch(localFilePath);
    if (!response.ok) {
      throw new Error(`Failed to load audio file: ${response.statusText}`);
    }
    
    const audioBuffer = await response.arrayBuffer();
    
    // Call onStart callback if provided
    onStart?.();
    
    // Play the audio with the VRM model
    if (viewer.model) {
      await viewer.model.speak(audioBuffer, screenplay);
    } else {
      console.warn("VRM model not loaded, cannot play audio");
    }
    
    // Call onComplete callback if provided
    onComplete?.();
    
    return Promise.resolve();
  } catch (error) {
    console.error("Error playing local audio:", error);
    onComplete?.(); // Still call onComplete even if there's an error
    return Promise.reject(error);
  }
};



export const speakCharacter = createSpeakCharacter();

export const fetchAudio = async (
  talk: Talk,
  apiKey: string
): Promise<ArrayBuffer> => {
  const ttsVoice = await synthesizeVoiceApi(
    talk.message,
    talk.speakerX,
    talk.speakerY,
    talk.style,
    apiKey
  );
  const url = ttsVoice.audio;

  if (url == null) {
    throw new Error("Something went wrong");
  }

  const resAudio = await fetch("intro.mp3");
  const buffer = await resAudio.arrayBuffer();
  return buffer;
};


synthesizeVoiceApi