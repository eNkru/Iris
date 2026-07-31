import { config as loadDotenv } from "dotenv";
import path from "node:path";

// Load the repo-root `.env` before any module that reads the validated env
// (e.g. the database client) is evaluated. Scripts run from packages/database.
loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
