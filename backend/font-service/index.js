// server/fontProxy.js
import express from 'express';
import fetch from 'node-fetch';

const app = express();          // <- this is the Express application
const fontRouter = express.Router();  // <- this is only a router

fontRouter.get('/gwf/:family', async (req, res) => {
  const { family } = req.params;
  const { variants = 'regular', subsets = 'latin' } = req.query;

  const api = `https://gwfh.mranftl.com/api/fonts/${encodeURIComponent(
    family.toLowerCase().replace(/\s+/g, '-')
  )}?variants=${variants}&subsets=${subsets}&formats=ttf`;

  try {
    const r = await fetch(api);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type('application/json');
    r.body.pipe(res);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// mount the router on the app (optionally give it a prefix)
app.use('/', fontRouter);

// start the HTTP server
const port = process.env.PORT || 3002;
app.listen(port, () => {
  console.log(`Font service listening on port ${port}`);
});
