# Rebuild it with Claude Code

This repo is one way to get the bookshelf: clone it, add your Goodreads export, run the pipeline. The other is to have Claude Code build your own version from scratch with the prompt below. It describes the result rather than the code, plus the pitfalls that cost the most iterations the first time round.

Start it in an empty folder with your Goodreads export in `data/`. Expect a result close to this repo in structure and behaviour in one session, then a few rounds of feedback on lighting, camera feel and cover sources. The **Working style** section matters most: Claude Code checks its own screenshots and asks you when a category is unclear.

````markdown
Build "Bookshelf": my Goodreads library as a photoreal 3D room in the browser. Static site, deployable to Netlify.

INPUT
- data/goodreads_library_export.csv (Goodreads → My Books → Export). Goodreads has no API, so the CSV is the only source.
- .env: ANTHROPIC_API_KEY (pipeline only, never shipped to the client).

STACK
Vite + React + TypeScript, react-three-fiber + drei, zustand, vitest. A Node pipeline (`npm run data`, run with tsx) produces public/data/books.json, covers and texture atlases. The site reads only those files.

PIPELINE
1. Parse the CSV.
   - Shelves: read, currently-reading, to-read. Drop "did-not-finish".
   - A custom shelf "favorites" marks favourites.
   - Strip reviews and private notes from the output.
2. Covers.
   - Download covers locally as WebP (never hotlink). Try Goodreads, then Amazon by ISBN, then Open Library, then Google Books.
   - Reject placeholders and tiny images. If nothing is found, generate a typographic cover.
3. Palette.
   - The dominant colour is the most common colour bucket of the cover, counting the outer border band double. This keeps black and white backgrounds.
   - Accent and text colours come from node-vibrant, which can't read WebP: decode with sharp to PNG first.
   - Never let a failure silently fall back to random colours. Log the count of fallbacks.
4. Dimensions.
   - Height by binding: hardcover 235 mm, paperback 215 mm, mass market 175 mm.
   - Thickness = pages × 0.06 mm + boards, clamped to 7–70 mm.
   - Width from the cover aspect ratio.
   - Missing page counts are estimated at the median and flagged.
5. Categories via Claude.
   - Pass 1 proposes 6–12 interest-area categories for THIS library, each with a slug, name and description. Write them to data/categories.json.
   - Pass 2 assigns a primary and an optional secondary category in batches of 50. Write the result to data/assignments.json.
   - Both files are hand-editable and are never recomputed for books that already have an entry.
6. data/overrides.json per book id: hide, title, author, coverUrl, shelf, category. data/extra-books.json for books missing from the export.
7. Spines are generated on a canvas.
   - The base is the dominant colour with a subtle rounded-light gradient and a cloth or paper texture.
   - Thin accent bands sit near the head and tail.
   - The title runs top to bottom, the author at the tail, with a font chosen per book.
   - Pack the spines into KTX2 texture atlases (a few large sheets, each book a UV rectangle). Do the same for covers.
8. Every step is cached on disk with a version number. Print a summary: covers by source, missing pages, books per category.
9. Everything random is seeded by book id, so builds are deterministic.

SCENE
1. Room.
   - A warm plaster wall and an oak floor.
   - Soft window light from the left, plus a warm directional key light with crisp shadows.
   - Neutral tone mapping, subtle SSAO and vignette. Depth of field only while a book is pulled out.
2. The bookcase is dark walnut with real grain, about 6 rows, and grows by columns as needed.
   - Each category starts in its own compartment. Compartments fill down each column, then move to the next column. No compartment ever overflows. Spare compartments go to the biggest categories.
   - Each compartment has a small brass label holder with the category name.
   - Sparse decor: an aluminium bookend, a vase with a branch, a plant, a bowl, a brass sphere.
3. Books are one InstancedMesh per atlas sheet: a rounded box with a custom shader.
   - The spine comes from the atlas, the boards in the dominant colour.
   - The page block shows fine page lines and shading near the boards.
   - Series and annual anthologies stand together in order.
   - Large books lie in a small stack at the end of a category.
   - One favourite per category stands face-out at its start.
4. Covers view (toggle at the bottom right, kept in `?view=covers`).
   - Every read book stands face-out on walnut display shelves with a front lip, leaning back slightly.
   - A slim aluminium LED strip runs under each shelf's front edge. Its warm wash falls on the back panel and the covers, fading downwards.
   - Each five-star book has a small puck spot in the shelf above it.
   - Keep it subtle and realistic.
5. Five-star switch: a wall light switch left of the bookcase with a brass "Five stars" plate, off by default.
   - Switching it on fades the room light down to a few percent, so everything else looks dimmed.
   - Covers view: the LED strips go off and the five-star spots come on, each throwing a cone of light on the back panel and a pool on its cover.
   - Spines view: five-star books slide about 4 cm out of the shelf and are lit from above.
   - The rocker tips and an amber pilot light glows while it is on. Pulling a book out brings the room light back up.
6. Left of the case, a low table holds every to-read book in neat stacks. Left of that, a small table holds the currently-reading books, lying flat with covers up.
7. Close-up books are built from parts: boards, page block, and a hinged front cover. Edges use the cover's real colours.

INTERACTION
- Navigation:
  - Dolly along the wall with horizontal scroll, drag or arrow keys.
  - Scroll vertically once zoomed in.
  - Pinch or ctrl-scroll zooms towards the cursor. Double-click zooms in.
  - The camera eases with slight pointer parallax.
  - Over the tables the gaze drops to the tabletops.
- Books:
  - Hover tips a book out and shows a tooltip with title, author and my stars.
  - Click pulls the book out to the camera. A second click opens it: a title page on the left and my rating and dates on the right.
  - Esc or a click outside puts it back. Neighbours lean into the gap.
  - Books slide in compartment by compartment on load.
- A top bar of chips flies the camera to "Reading now", "Want to read" and each category.
- Deep links: `#category/{slug}`, `#book/{id}`.

PRIVACY
- noindex meta tags and robots.txt, no analytics.
- No API keys in the client bundle.

WORKING STYLE
- Build the pipeline first and show me the summary. Then propose the categories and let me edit them before assigning.
- After every visual change, take Playwright screenshots against the dev server and look at them yourself before reporting. Add dev-only window hooks to find a book's screen position.
- Unit-test the layout invariants: no book outside its compartment, one category per compartment, column-major fill.
- Ask me when a category assignment is uncertain.
````
