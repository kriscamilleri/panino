/**
 * The add-ons that ship with this server, one import per add-on. Importing an
 * add-on registers its manifest (registry.js). Load this before any database
 * opens, so add-on tables are created with the rest (index.js does). Tests get
 * it through createTestApp; a unit test that needs add-on tables without the
 * app imports the add-on's index.js itself.
 */

import './github/index.js';
import './odoo/index.js';
