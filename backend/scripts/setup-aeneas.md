# Aeneas Setup Guide

Aeneas is a Python/C library for automatic audio-text synchronization (forced alignment). It's used by professional ebook publishers like Kitaboo for Media Overlays in EPUB 3.

## Prerequisites

1. **Python 3.6+**
2. **FFmpeg** - For audio processing
3. **espeak-ng** - For phoneme generationPS C:\Windows\system32> python -version
Unknown option: -e
usage: C:\Python313\python.exe [option] ... [-c cmd | -m mod | file | -] [arg] ...
Try `python -h' for more information.
PS C:\Windows\system32> python -m aeneas.diagnostics
C:\Python313\python.exe: Error while finding module specification for 'aeneas.diagnostics' (ModuleNotFoundError: No module named 'aeneas')
PS C:\Windows\system32> pip install aeneas 2>&1 | Select-Object -Last 30
Collecting aeneas
  Using cached aeneas-1.7.3.0.tar.gz (5.5 MB)
  Installing build dependencies: started
  Installing build dependencies: finished with status 'done'
  Getting requirements to build wheel: started
  Getting requirements to build wheel: finished with status 'error'
pip :   error: subprocess-exited-with-error
At line:1 char:1
+ pip install aeneas 2>&1 | Select-Object -Last 30
+ ~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (  error: subprocess-exited-with-error:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError


  Getting requirements to build wheel did not run successfully.
  exit code: 1

  [3 lines of output]
  [ERRO] You must install numpy before installing aeneas
  [INFO] Try the following command:
  [INFO] $ sudo pip install numpy
  [end of output]

  note: This error originates from a subprocess, and is likely not a problem with pip.
[notice] A new release of pip is available: 25.2 -> 25.3
[notice] To update, run: python.exe -m pip install --upgrade pip
error: subprocess-exited-with-error
Getting requirements to build wheel did not run successfully.
exit code: 1
See above for output.
note: This error originates from a subprocess, and is likely not a problem with pip.
PS C:\Windows\system32>

## Installation

### Windows

```powershell
# 1. Install Python (if not already installed)
winget install Python.Python.3.11

# 2. Install FFmpeg
winget install Gyan.FFmpeg

# 3. Install espeak-ng
# Download from: https://github.com/espeak-ng/espeak-ng/releases
# Or use Chocolatey:
choco install espeak-ng

# 4. Install Aeneas
pip install numpy
pip install aeneas
```

### macOS

```bash
# Using Homebrew
brew install python@3.11 ffmpeg espeak

# Install Aeneas
pip3 install numpy
pip3 install aeneas
```

### Linux (Ubuntu/Debian)

```bash
# Install dependencies
sudo apt-get update
sudo apt-get install -y python3 python3-pip ffmpeg espeak espeak-data libespeak-dev

# Install Aeneas
pip3 install numpy
pip3 install aeneas
```

## Verify Installation

```bash
# Check Aeneas is working
python -m aeneas.diagnostics

# Or run a simple test
python -m aeneas.tools.execute_task --help
```

## How Aeneas Works

Aeneas uses a three-step process:

1. **Text Normalization**: Strips formatting from text input
2. **Acoustic Modeling**: Uses espeak to generate phonemes and DTW (Dynamic Time Warping) to match audio
3. **Alignment**: Outputs precise timestamps for each text segment

### Example Usage

```python
from aeneas.tools.execute_task import ExecuteTask
from aeneas.executetask import ExecuteTaskCLI

# Configuration string
config = "task_language=eng|is_text_type=plain|os_task_file_format=json"

# Execute alignment
ExecuteTaskCLI(
    audio_file="audiobook.mp3",
    text_file="chapters.txt",
    config_string=config,
    output_file="sync.json"
)
```

## Supported Languages

Aeneas supports 30+ languages including:

| Code | Language |
|------|----------|
| eng | English |
| fra | French |
| deu | German |
| spa | Spanish |
| ita | Italian |
| por | Portuguese |
| hin | Hindi |
| cmn | Chinese (Mandarin) |
| jpn | Japanese |
| kor | Korean |
| ara | Arabic |
| rus | Russian |

## Performance

- Aeneas processes 5 minutes of audio in ~15 seconds
- A 300-page audiobook can be synced in ~15 minutes
- CPU-bound, so more cores = faster processing

## Troubleshooting

### "espeak not found"
- Ensure espeak-ng is installed and in PATH
- On Windows, add `C:\Program Files\eSpeak NG` to PATH

### "ffmpeg not found"
- Ensure ffmpeg is installed and in PATH
- Run `ffmpeg -version` to verify

### "Permission denied"
- On Linux, you may need to use `sudo pip3 install aeneas`

## Fallback: Linear Spread

If Aeneas cannot be installed, the system falls back to "Linear Spread" mode:

1. User provides start and end timestamps
2. System spreads timings proportionally based on character count
3. Use "Snap to Silence" feature to refine automatically

This is less accurate but still provides 80%+ usable results.

## Resources

- [Aeneas Documentation](https://www.readbeyond.it/aeneas/docs/)
- [GitHub Repository](https://github.com/readbeyond/aeneas)
- [EPUB 3 Media Overlays Spec](https://www.w3.org/TR/epub-33/#sec-media-overlays)

