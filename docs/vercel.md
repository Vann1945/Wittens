# Deploying on Vercel

Wittens includes a Vercel adapter for the Express API and serves the built web app from `web/dist`.

1. Import the repository into Vercel.
2. Keep the project root at the repository root.
3. Set any required API environment variables from `api/.env.example` in Project Settings.
4. Deploy with the default configuration. `vercel.json` runs the workspace build, serves `web/dist`, and routes the API through `api/index.ts`.

The API keeps tunnel state in memory. Vercel may start more than one function instance, and a restart invalidates active download links. For a single long-lived instance with stable in-memory state, use the included Docker deployment instead.
