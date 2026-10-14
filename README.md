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

## Admin access

`/` is public. `/admin` uses server-side HTTP Basic authentication and a private HTML template outside the public static directory. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Vercel's project environment variables before deploying. Credentials are never stored in this repository. If either variable is absent, admin access fails closed. The admin page does not collect or display participant responses.

For local development, export those same environment variables before starting uvicorn. The browser presents the login dialog when visiting `/admin`.

## Privacy and scope

Answers are held only in JavaScript memory in the current tab. Reloading or closing the tab clears them. There is no answer submission endpoint, database, analytics, AI model, or account system. Downloading explicitly saves a text file to the visitor's device. Read-aloud uses an offline English system voice when available. Fonts load from Google Fonts. Vercel may retain standard request metadata; answer text is never included in requests.

This is a conversation starter, not an assessment. Review the questions and test with intended participants and their assistive technologies before using it for research. Customize the questions in `static/app.js` and appearance in `static/style.css`.
