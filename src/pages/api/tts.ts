import { conquaTTS, koeiromapFreeV1 } from "@/features/koeiromap/koeiromap";

import type { NextApiRequest, NextApiResponse } from "next";

type Data = {
  audio: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const message = req.body.message;

  const speakerX = req.body.speakerX;
  const speakerY = req.body.speakerY;
  const style = req.body.style;
  const apiKey = "";
  const style_wav = req.body.style_wav;

  const speaker_id = req.body.speaker_id;
  const language_id = req.body.language_id;


 //send 
  const voice = await conquaTTS(
    message,
    speakerX,

  );

  console.log("voice", voice);
  

}
