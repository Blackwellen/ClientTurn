# Industry card imagery

The images behind the home page industries carousel
(`src/components/marketing/public/home/industry-data.ts`). Every sector is
inside the B2B ICP in `CLAUDE.md` (resolved conflict 5).

Two kinds of file live here:

* **Photographs (`.webp`)** from [Openverse](https://openverse.org), filtered
  to **CC0** / public-domain-mark results: the two licences that permit
  commercial use with **no attribution condition**, so the site carries no
  attribution debt it could silently break. Each is centre-cropped to 3:2 and
  saved as WebP at 1200x800.
* **Illustrations (`.svg`)** drawn for ClientTurn in the brand palette
  (midnight `#0B1020`, lime `#B7F34A`, soft lime `#E7FFC0`, cloud `#F7F9FC`),
  used where no fitting CC0 photograph exists. Same 1200x800 canvas. Next
  serves an `.svg` source unoptimised, and the card skips the dimming it
  applies to photographs.

`CREDITS.json` records the title, creator, licence and source for each one.
Keep it in step if you replace or add an image.

The card is a 168px-tall banner behind a gradient wash, so keep the subject in
the middle band of the canvas.

To swap one out: replace the file, update its `CREDITS.json` entry, and update
`imageAlt` in `industry-data.ts` if the subject changed.
