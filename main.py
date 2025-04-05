#!/usr/bin/env python
import argparse
import io
import json
import os
import sys
from pathlib import Path
from threading import Lock
from typing import Union, Optional
from fastapi import FastAPI, Request, Response, Query
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from TTS.config import load_config
from TTS.utils.manage import ModelManager
from TTS.utils.synthesizer import Synthesizer
import uvicorn

def create_argparser():
    def convert_boolean(x):
        return x.lower() in ["true", "1", "yes"]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--list_models",
        type=convert_boolean,
        nargs="?",
        const=True,
        default=False,
        help="list available pre-trained tts and vocoder models.",
    )
    parser.add_argument(
        "--model_name",
        type=str,
        default="tts_models/en/ljspeech/tacotron2-DDC",
        help="Name of one of the pre-trained tts models in format <language>/<dataset>/<model_name>",
    )
    parser.add_argument("--vocoder_name", type=str, default=None, help="name of one of the released vocoder models.")
    # Args for running custom models
    parser.add_argument("--config_path", default=None, type=str, help="Path to model config file.")
    parser.add_argument(
        "--model_path",
        type=str,
        default=None,
        help="Path to model file.",
    )
    parser.add_argument(
        "--vocoder_path",
        type=str,
        help="Path to vocoder model file. If it is not defined, model uses GL as vocoder. Please make sure that you installed vocoder library before (WaveRNN).",
        default=None,
    )
    parser.add_argument("--vocoder_config_path", type=str, help="Path to vocoder model config file.", default=None)
    parser.add_argument("--speakers_file_path", type=str, help="JSON file for multi-speaker model.", default=None)
    parser.add_argument("--port", type=int, default=1602, help="port to listen on.")
    parser.add_argument("--use_cuda", type=convert_boolean, default=False, help="true to use CUDA.")
    parser.add_argument("--debug", type=convert_boolean, default=False, help="true to enable debug mode.")
    parser.add_argument("--show_details", type=convert_boolean, default=False, help="Generate model detail page.")
    return parser

# parse the args
args = create_argparser().parse_args()

path = Path(__file__).parent / "../.models.json"
manager = ModelManager(path)

if args.list_models:
    manager.list_models()
    sys.exit()

# update in-use models to the specified released models.
model_path = None
config_path = None
speakers_file_path = None
vocoder_path = None
vocoder_config_path = None

# CASE1: list pre-trained TTS models
if args.list_models:
    manager.list_models()
    sys.exit()

# CASE2: load pre-trained model paths
if args.model_name is not None and not args.model_path:
    model_path, config_path, model_item = manager.download_model(args.model_name)
    args.vocoder_name = model_item["default_vocoder"] if args.vocoder_name is None else args.vocoder_name

if args.vocoder_name is not None and not args.vocoder_path:
    vocoder_path, vocoder_config_path, _ = manager.download_model(args.vocoder_name)

# CASE3: set custom model paths
if args.model_path is not None:
    model_path = args.model_path
    config_path = args.config_path
    speakers_file_path = args.speakers_file_path

if args.vocoder_path is not None:
    vocoder_path = args.vocoder_path
    vocoder_config_path = args.vocoder_config_path

# load models
synthesizer = Synthesizer(
    tts_checkpoint=model_path,
    tts_config_path=config_path,
    tts_speakers_file=speakers_file_path,
    tts_languages_file=None,
    vocoder_checkpoint=vocoder_path,
    vocoder_config=vocoder_config_path,
    encoder_checkpoint="",
    encoder_config="",
    use_cuda=args.use_cuda,
)

use_multi_speaker = hasattr(synthesizer.tts_model, "num_speakers") and (
    synthesizer.tts_model.num_speakers > 1 or synthesizer.tts_speakers_file is not None
)
speaker_manager = getattr(synthesizer.tts_model, "speaker_manager", None)

use_multi_language = hasattr(synthesizer.tts_model, "num_languages") and (
    synthesizer.tts_model.num_languages > 1 or synthesizer.tts_languages_file is not None
)
language_manager = getattr(synthesizer.tts_model, "language_manager", None)

# TODO: set this from SpeakerManager
use_gst = synthesizer.tts_config.get("use_gst", False)

# Create templates directory if it doesn't exist
os.makedirs("templates", exist_ok=True)

# Create FastAPI app
app = FastAPI(title="TTS Server")
templates = Jinja2Templates(directory="templates")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Try to mount static files if directory exists
try:
    app.mount("/static", StaticFiles(directory="static"), name="static")
except RuntimeError:
    print("Static directory not found. Static file serving disabled.")

# Create a lock for thread safety
lock = Lock()

def style_wav_uri_to_dict(style_wav: str) -> Union[str, dict]:
    """Transform an uri style_wav, in either a string (path to wav file to be use for style transfer)
    or a dict (gst tokens/values to be use for styling)
    Args:
        style_wav (str): uri
    Returns:
        Union[str, dict]: path to file (str) or gst style (dict)
    """
    if style_wav:
        if os.path.isfile(style_wav) and style_wav.endswith(".wav"):
            return style_wav  # style_wav is a .wav file located on the server
        style_wav = json.loads(style_wav)
        return style_wav  # style_wav is a gst dictionary with {token1_id : token1_weigth, ...}
    return None

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "show_details": args.show_details,
            "use_multi_speaker": use_multi_speaker,
            "use_multi_language": use_multi_language,
            "speaker_ids": speaker_manager.name_to_id if speaker_manager is not None else None,
            "language_ids": language_manager.name_to_id if language_manager is not None else None,
            "use_gst": use_gst,
        }
    )

@app.get("/details", response_class=HTMLResponse)
async def details(request: Request):
    model_config = None
    vocoder_config = None
    
    if args.config_path is not None and os.path.isfile(args.config_path):
        model_config = load_config(args.config_path)
    elif args.model_name is not None:
        model_config = load_config(config_path)
    
    if args.vocoder_config_path is not None and os.path.isfile(args.vocoder_config_path):
        vocoder_config = load_config(args.vocoder_config_path)
    elif args.vocoder_name is not None:
        vocoder_config = load_config(vocoder_config_path)
    
    return templates.TemplateResponse(
        "details.html",
        {
            "request": request,
            "show_details": args.show_details,
            "model_config": model_config,
            "vocoder_config": vocoder_config,
            "args": args.__dict__,
        }
    )

@app.get("/api/tts")
@app.post("/api/tts")
async def tts(
    request: Request,
    text: Optional[str] = Query(None),
    speaker_id: Optional[str] = Query(None),
    language_id: Optional[str] = Query(None),
    style_wav: Optional[str] = Query(None)
):
    with lock:
        # Get parameters from query or header
        if text is None:
            text = request.headers.get("text", "")
        
        speaker_idx = speaker_id
        if speaker_idx is None:
            speaker_idx = request.headers.get("speaker-id", "")
        
        language_idx = language_id
        if language_idx is None:
            language_idx = request.headers.get("language-id", "")
        
        style_wav_param = style_wav
        if style_wav_param is None:
            style_wav_param = request.headers.get("style-wav", "")
        
        style_wav_dict = style_wav_uri_to_dict(style_wav_param)
        
        print(f" > Model input: {text}")
        print(f" > Speaker Idx: {speaker_idx}")
        print(f" > Language Idx: {language_idx}")
        
        wavs = synthesizer.tts(text, speaker_name=speaker_idx, language_name=language_idx, style_wav=style_wav_dict)
        out = io.BytesIO()
        synthesizer.save_wav(wavs, out)
        out.seek(0)
    
    return StreamingResponse(out, media_type="audio/wav")

# Basic MaryTTS compatibility layer
@app.get("/locales")
async def mary_tts_api_locales():
    """MaryTTS-compatible /locales endpoint"""
    # NOTE: We currently assume there is only one model active at the same time
    if args.model_name is not None:
        model_details = args.model_name.split("/")
    else:
        model_details = ["", "en", "", "default"]
    
    return Response(content=model_details[1], media_type="text/plain")

@app.get("/voices")
async def mary_tts_api_voices():
    """MaryTTS-compatible /voices endpoint"""
    # NOTE: We currently assume there is only one model active at the same time
    if args.model_name is not None:
        model_details = args.model_name.split("/")
    else:
        model_details = ["", "en", "", "default"]
    
    return Response(
        content=f"{model_details[3]} {model_details[1]} u\n", 
        media_type="text/plain"
    )

@app.get("/process")
@app.post("/process")
async def mary_tts_api_process(request: Request, INPUT_TEXT: Optional[str] = None):
    """MaryTTS-compatible /process endpoint"""
    with lock:
        text = INPUT_TEXT or ""
        
        if not text and request.method == "POST":
            form_data = await request.form()
            text = form_data.get("INPUT_TEXT", "")
            
            if not text:
                body = await request.body()
                try:
                    # Try to parse as form-encoded data
                    from urllib.parse import parse_qs
                    form_data = parse_qs(body.decode())
                    text = form_data.get("INPUT_TEXT", [""])[0]
                except:
                    pass
        
        print(f" > Model input: {text}")
        wavs = synthesizer.tts(text)
        out = io.BytesIO()
        synthesizer.save_wav(wavs, out)
        out.seek(0)
    
    return StreamingResponse(out, media_type="audio/wav")



if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=1602, reload=True)