# beanies graphic catalogue

Every illustration available to a pin, so the choice is made from the whole set rather than
from the two or three that happen to be top of mind. **Read this before picking art.**

All paths are relative to `{{ASSET_BASE}}`, which `render-pin.mjs` rewrites to
`packages/brand/assets` — the one home for beanies media. Three subfolders:

| folder | what is in it |
| --- | --- |
| `shared/` | mascots, logos, celebration art, reaction faces, icons |
| `marketing/` | pricing heroes, the reading hero, store art, OG image |
| `blog/` | per-post images, for pin-to-post visual continuity |

> Regenerate this list after adding artwork: `ls packages/brand/assets/{shared,marketing,blog}`.
> A file that is not in this catalogue is still usable; the catalogue is a menu, not a whitelist.

---

## Family and togetherness

| asset | what it shows | good for |
| --- | --- | --- |
| `shared/beanies_family_hugging_transparent_1600x1600.png` | Six beans in a group hug: two parents behind, three kids in front, arms wrapped round each other. Transparent, square. **The highest-resolution hero in the set.** | the default brand statement, togetherness, "one place for the family". 512 and 1024 sizes also exist |
| `marketing/beanies-family-reading.webp` | Five beans clustered round an open olive storybook with a small flower on the page. Softer, painterly shading. Transparent, square. | **the cosiest asset there is.** bedtime routine, reading together, screen-free evenings, family rituals |
| `shared/beanies_father_son_icon_512x512.png` | A tall slate bean and a small orange bean hand in hand on a rising orange arrow. **Opaque pale-blue-to-peach background**, so it needs a light ground or a panel behind it. | growth, progress, savings goals, parent-and-child |
| `shared/beanies_celebrating_line_transparent_560x225.png` | Four beans in a row holding hands, two blowing party horns, music notes and confetti. Transparent, **wide banner**. | the `strip` layout as a bottom band. celebrations, milestones, wins |

## Money

| asset | what it shows | good for |
| --- | --- | --- |
| `marketing/beanies-pricing-pockets.webp` | A big slate bean grinning and pulling both trouser pockets inside out, a small orange bean cheering beside it, and the spotted dog carrying a wallet of banknotes. Transparent, near-square. | **the only real money graphic, and it is genuinely funny.** free/low-cost, budgeting, "it costs nothing", money talk |
| `marketing/beanies-pricing-dog.webp` | The spotted sausage-dog in a slate beanie, alone. Transparent. | a playful accent on a money pin, or a corner sticker |

## Growth and the beanstalk

| asset | what it shows | good for |
| --- | --- | --- |
| `shared/beanies-beanstalk-mascot.webp` | A beanstalk character: braided terracotta and green stems, a bean face in a teal beanie on top, holding pink daisies and bean pods, music notes floating. Transparent, **480x819 portrait**. | **the only natively portrait asset**, so it fills a 2:3 pin with no cropping. use with the `portrait` layout. growth, habits, "every bean counts", anything beanstalk-branded |
| `shared/beanies-beanstalk-banner.webp` | Four curling vines as die-cut stickers, one topped by a smiling cloud. Transparent, wide. | a decorative strip across the top or bottom. individual vines crop out well |

## Reactions and emotion

| asset | what it shows | good for |
| --- | --- | --- |
| `shared/beanies_open_eyes_transparent_512x512.png` | Full-body orange bean, arms in the air, huge wide eyes, delighted open mouth, mint beanie. Transparent. | reveals, surprise and delight, "wait, really?" |
| `shared/beanies_covering_eyes_transparent_512x512.png` | The same bean with both arms over its eyes and a worried squiggle mouth. Transparent. | privacy, "we cannot see your data", money anxiety. **pairs directly with the one above as a before/after** |
| `shared/beanies_celebrating_circle_transparent_600x600.png` | Five beans in a ring, mid-jump, arms and legs flung out, laughing. Transparent, **with a deliberate hole in the middle**. | the `ring` layout, with the headline sitting inside it. milestones, streaks, celebrating wins |

## Single mascots and faces

| asset | what it shows | good for |
| --- | --- | --- |
| `shared/beanies_small_bean_favicon_512x512.png` | One bold-outlined orange bean in a navy beanie. High contrast, heavy sticker outline. Transparent. | **the footer lockup stamp** (already wired in the template), corner badges, bullets |
| `shared/beanies_father_icon_transparent_360x360.png` | Orange bean face, closed-mouth smile, dark slate beanie. Transparent. | member avatars, a "dad" persona, a row of family faces |
| `shared/beanies_mother_icon_transparent_350x350.png` | Same face style with long chestnut hair and a pink beanie. Transparent. | pairs with the father icon |
| `shared/beanies_neutral_icon_transparent_350x350.png` | A rounder, glossier, more 3D bean head in a cream beanie. Transparent. | a single friendly face. **note it is shinier than the father/mother icons and does not sit flush beside them** |
| `shared/beanies_baby_boy_icon_transparent_300x300.png` / `shared/beanies_baby_girl_icon_transparent_300x300.png` | Baby bean faces, one with a bottle and teal beanie, one with a pink bonnet. Transparent. | new baby, expecting, adding a family member |
| `shared/beanies_pet_dog_icon_transparent_350x350.png` | The spotted sausage-dog, slightly wider crop than the pricing version. Transparent. | pets, family members, a cheerful corner sticker |
| `shared/beanies_reminder_bell_transparent_512x512.png` | A bean-shaped bell with a happy face in a slate beanie. Transparent. | reminders, notifications, "never forget a thing". better as an inset than a hero |
| `shared/beanies_logo_transparent_1024x1024.png` | The full lockup: two beans on a rising arrow with the `beanies.family` wordmark beneath. Transparent. | a sign-off block when you want the wordmark in the art itself |

## Blog images, for pin-to-post continuity

`blog/` holds every image used in a beanstalk post. When a pin points at a specific post,
**reusing an image from that post is a real option** and gives the reader continuity from the
pin to the page they land on. It should not be every pin, but it is a good move when the post
has a strong image of its own (a photo greg took, a screenshot, a meme).

`ls packages/brand/assets/blog` for the current list. Match the image to the post you are
linking to, not to a random one.

---

## Known asset defects — do not use these without checking

These came out of a full visual audit on 2026-09-16 and were verified at pixel level.

- **`marketing/beanies-logo.png` is NOT the logo.** It is byte-identical to
  `beanies_celebrating_circle_transparent_400x400.png`, the ring of jumping beans. It is
  currently wired to the JSON-LD organisation logo and every generated OG card. Use
  `shared/beanies_logo_transparent_1024x1024.png` when you want the actual logo.
- **`beanies_family_icon_transparent_384x384.png` has a transparency checkerboard baked into
  its pixels** as a ring inside the circle. Unusable as-is.
- **`beanies_plus_sign_512x512.png` has a checkerboard baked across the whole square.** Use
  `beanies_plus_sign.svg` instead.
- **Three logo files carry wrong size suffixes.** `beanies_favicon_transparent_100x100.png` is
  really 1056x992, `_32x32` is 337x317, and `beanies_apple_touch_icon_transparent_180x180.png`
  is really **1900x1785** and is the highest-resolution copy of the logo mark you have.
- **`beanies_father_son_icon` is two different artworks under one name** — the PNG is a light
  square, the WEBP is a dark navy and amber badge. Check which one you are getting.
- `beanies-family-reading`, `beanies-pricing-pockets` and `beanies-pricing-dog` exist **only as
  WEBP**, so there is no lossless master. Fine at pin scale, a limit for print.
