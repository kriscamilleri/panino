// The areas of the v1 API, in the order their tools are listed and their routes
// mounted. Each area module exports:
//   tools      MCP tools: { name, title, description, access, annotations, inputSchema, run }
//              run(ctx, args) returns (or resolves to) { text, structured, content? },
//              where content is extra MCP content blocks after the text (an image, a file)
//   nextSteps  { [v1 error code]: sentence telling the model what to do next }
//   routes     (router) => registers the area's REST routes
//   paths      OpenAPI path items; areas may share a path with different methods
import * as documents from './documents.js';
import * as folders from './folders.js';
import * as images from './images.js';
import * as library from './library.js';
import * as revisions from './revisions.js';

export const AREAS = Object.freeze([documents, folders, revisions, images, library]);
