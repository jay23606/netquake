/**
 * File: app.ts
 * Purpose: Boot the Quake2JS web application from the root page.
 *
 * This file is not a direct source port.
 * It is a small browser entry point that keeps public URLs generic while the
 * runtime implementation remains split into focused modules.
 */

import "./app-runtime.js";
import { installPakUpload } from "./pak-upload.js";

// Lets a player add their own Quake II data; the site ships only the demo pak.
void installPakUpload();
