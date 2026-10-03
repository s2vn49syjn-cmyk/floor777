# iPhone home-screen icon audit (2026-10-03)

## Confirmed repository defects

Base: `361a66f` (origin/main at inspection).

- The committed `apple-touch-icon.png` is 180 × 180 but uses a 16-entry, almost monochrome palette. No pixel has channel spread greater than 25. The pin and 777 are dull gray/brown in the actual PNG, independently of iOS settings. Introduced by `390d28b`.
- HTML favicons and the web manifest select `icon-192.jpg`, which Chromium rejects with “The source image cannot be decoded.” Pillow also rejects it.
- `icon-512.jpg` retains the approved floor-plan / red-pin / white FLOOR / red 777 artwork. Chromium decodes it; Pillow's strict JPEG decoder reports a broken stream. It contains existing compression/texture artifacts, so it should not be treated as a pristine design master.
- The unused 192/512 PNG files still contained the old blue mark, so simply switching the extensions would select the wrong brand.

## Reviewable repair

The 512 JPEG's Chromium-decoded pixels are the source for opaque PNG exports at 512, 192 and 180 pixels. The repair retains that existing colored artwork; it does not adopt any of the separate new design candidates. The 512 PNG is pixel-identical to the Chromium-decoded JPEG. Smaller exports use canvas high-quality downsampling. Original JPEGs remain for reference and old links, but no current icon/manifest declaration selects them.

All 15 HTML pages, including nested halls, legal pages, 404 and offline, declare the same root-relative PNG favicon, Apple touch icon and manifest. Asset query versions and the service-worker cache name are advanced together. The existing service worker is network-first, strips query strings for its own cache keys and deletes only older FLOOR777 caches during activation. The version does not promise to refresh an already installed iOS Web Clip icon automatically.

No CSS, map data, builder source, PR48 or PR49 is changed. No merge or deployment is authorized by this repair.

## Validation and limits

- Existing `npm test` and `node tests/hall-template.mjs` pass with system Chromium.
- Added `tests/icons.cjs` runs in the normal npm test/CI command. Checks all 15 pages, resolved paths, one declaration per icon type, local HTTP 200/MIME, PNG signatures, browser decoding, exact sizes, opaque pixels, measurable red accents, manifest consistency and missing-file 404.
- Existing cache tests cover versioned requests, network priority, network/500 fallback and isolation from sibling-site caches.
- Public `https://floor777.com/` and the icon could not be fetched in this execution environment: outbound proxy CONNECT returns 403, including an escalated read-only retry. GitHub Pages alias is similarly blocked; direct DNS is unavailable. **Production image bytes, deployed page declarations, real CDN MIME/cache headers and public 404 behavior remain unverified.** Local fixture HTTP verification is not production verification.
- The user's screenshot, installed icon age, exact iOS version and customization settings are unavailable. The repository asset is demonstrably desaturated, but it cannot establish the sole cause on the user's phone. No device settings were changed, and no iPhone installation test was performed.

Apple documents PNG `apple-touch-icon` selection and the 180 × 180 link example in its archived [Safari Web Content Guide](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html). Its current [Home Screen customization guide](https://support.apple.com/guide/iphone/customize-apps-and-widgets-on-the-home-screen-iph385473442/ios) separately documents Dark and Tinted appearances and adjustable tint saturation. Those OS options are possible additional causes of changed colors; they are not evidence that this particular phone has them enabled. An ordinary web PNG cannot be assumed to override the user's system appearance.

After approval and deployment, verify actual production headers/bytes, then compare a freshly added icon on the user's device with its current appearance setting recorded. Do not promise the website can force full color in tinted mode.
