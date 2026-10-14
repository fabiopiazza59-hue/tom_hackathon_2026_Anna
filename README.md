# Anna · Your voice, your pace

A Python / FastAPI starter for person-led conversations with people with disabilities. Six optional questions, keyboard-friendly navigation, larger text, high contrast, offline browser speech when available, pause/resume, and a downloadable summary.

## Run locally

Install [uv](https://docs.astral.sh/uv/), then:

```sh
uv sync
uv run uvicorn app:app --reload
```

Open http://127.0.0.1:8000.

```sh
uv run pytest
```

## Deploy to Vercel

Import this GitHub repository into Vercel with the repository root as the root directory and the FastAPI framework preset. Vercel installs Python dependencies from `pyproject.toml` and `uv.lock` and discovers `app.py`.

Alternatively run `npx vercel --prod` from the repository root.

## Privacy and scope

Answers are held only in JavaScript memory in the current tab. Reloading or closing the tab clears them. There is no answer submission endpoint, database, analytics, AI model, or account system. Downloading explicitly saves a text file to the visitor's device. Read-aloud uses an offline English system voice when available. Fonts load from Google Fonts. Vercel may retain standard request metadata; answer text is never included in requests.

This is a conversation starter, not an assessment. Review the questions and test with intended participants and their assistive technologies before using it for research. Customize the questions in `static/app.js` and appearance in `static/style.css`.
