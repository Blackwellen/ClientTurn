# Industry cover photography

Every image here came from [Openverse](https://openverse.org) filtered to
**CC0** / public-domain-mark results — the two licences that permit commercial
use with **no attribution condition**, so the site carries no attribution debt
it could silently break.

`CREDITS.json` records the title, creator, licence and source page for each
one anyway. Keep it in step if you replace an image.

Each file is centre-cropped to 3:2 and saved as WebP at 1200x800, which is what
the industry card needs: a 168px-tall banner sitting behind a gradient wash.
They are referenced from `industry-data.ts` via the `image` field and are all
lazy-loaded — the section is well below the fold.

To swap one out: replace the `.webp`, update its `CREDITS.json` entry, and
update `imageAlt` in `industry-data.ts` if the subject changed.
