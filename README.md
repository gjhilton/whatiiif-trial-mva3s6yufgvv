# ![WhatIIIF](engine/artwork/whatiffflogo.png)

**See the demo: [gjhilton.github.io/whatiiif-demo](https://gjhilton.github.io/whatiiif-demo/)**

Put one large picture on the web, zoomable, for free: a map, a manuscript page, a painting, a photograph.
You upload the image to GitHub, and GitHub builds a website where anyone can zoom into it, share a link to any
detail, or embed it in their own page. The picture is also published as [IIIF](https://iiif.io), the standard
that museum and library viewers such as Mirador and Universal Viewer read.

You need a free GitHub account, and nothing else: everything below happens in your web browser.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="engine/artwork/demo-dark.png">
  <img src="engine/artwork/demo.png" alt="The demo site: a picture of concentric rings in a zoomable viewer, its size below it, and the links to share, cite, use and download it">
</picture>

*The [demo site](https://gjhilton.github.io/whatiiif-demo/), light or dark to match how you are reading this.*

## What you get

### For people looking at your picture

| Feature | What it means |
|---|---|
| **Deep zoom** | From the whole picture down to every pixel, in [OpenSeadragon](https://openseadragon.github.io) or [Mirador](https://projectmirador.org). They can switch between the two. |
| **Links to details** | A link to exactly the part they have zoomed into. In OpenSeadragon, whoever opens it sees that part outlined for a moment. |
| **Embedding** | Code that puts the zoomable picture into a blog post or another website. It fits narrow screens and, in OpenSeadragon, lets readers scroll on past it. |
| **Citing** | A citation of the view on screen: who made the picture and when, its title, credit and link, and the day it was viewed. |
| **Downloads** | The view on screen as a JPEG, the full-size JPEG, and your original file, each with its size. You can switch off the last two. |
| **Real size** | A scale bar in OpenSeadragon, if you give the size of the original. |
| **Their language** | Your texts in every language you write them in. Visitors see their own and can switch. |
| **Light or dark** | Black on white, or white on black if their computer is set to dark mode; or your own colours. |
| **Any screen, and paper** | Works on phones and in Safari. Printed, it shows the view on screen, the details and the citation. Without JavaScript, it still shows the picture. |
| **Accessibility** | Alternative text for people who cannot see the picture, and every page checked automatically against the WCAG 2.1 AA guidelines. |
| **Link previews** | Links shared on social media and in chat apps show the picture, its title and summary. Search engines are told its credit and licence. |

### For you

| Feature | What it means |
|---|---|
| **Free** | No server and no cost: GitHub builds the site and hosts it. |
| **All in the browser** | Upload a TIFF, PNG, JPEG, WebP, AVIF or GIF, of up to 2 GB ([Large pictures](#large-pictures) shows how). |
| **A settings helper** | A form on your site that writes your settings for you, and checks them as the build will. |
| **Big pictures fit** | If the site would be too big for GitHub Pages, the full-size JPEG is left out and, if need be, the tiles are made at a lower JPEG quality, to make room. |
| **Photos handled with care** | Turned the right way up, their colours kept true, and the camera's and location details left out. |
| **Your words** | A title, summary, creator, date, credit, licence, real size and any other details you like, and a description that can link to parts of the picture. |
| **Plain-English mistakes** | A mistake is explained in a sentence at the top of the page of the build that found it, and so is anything worth a look. |
| **Updates** | Improvements arrive by themselves, or as a pull request for you to merge. Your picture and settings are never touched. |
| **IIIF** | The picture is published as a [IIIF](https://iiif.io) image service and manifest, so it opens in any IIIF viewer. |

**Later, if you want them:** [notes on the picture, and a tour](#going-further-notes-on-the-picture-and-a-tour) that visitors
can step through. Your site does not need them, and you can add them at any time.

## Make your site

1. **Copy this template.** At the top of this page click **Use this template → Create a new repository**.
   Give it a name (it becomes part of your site's address), choose **Public**, and click **Create repository**.
2. **Switch on GitHub Pages.** In your new repository open **Settings → Pages**. Under **Source**, choose
   **GitHub Actions**.
3. **Add your picture.** Go to the **Code** tab, open the **content** folder, and choose
   **Add file → Upload files**. Drop in one TIFF, PNG or JPEG (WebP, AVIF and GIF work too), then click
   **Commit changes**.
4. **Wait a minute or two.** The **Actions** tab shows your site being built. A green tick means it is ready.
5. **Visit your site** at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`. The address is also shown under
   **Settings → Pages**.

The browser uploads files of up to 25 MB. For a bigger picture, see [Large pictures](#large-pictures).

## Describe your picture (optional)

The easiest way is your site's **settings helper**, at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/settings.html`
once your site has been built. Fill in the form, copy what it makes, and paste it over `content/whatiiif.toml` on GitHub: the helper links to the
file, and checks everything as the build will. It starts from your site's settings as they are.

![The settings helper: the form on the left, and on the right the whatiiif.toml it writes, ready to copy](engine/artwork/settings.png)

Or edit the file yourself: open `content/whatiiif.toml`, click the pencil icon to edit it, and fill in the lines you
want. Remove the `#` at the start of each line you use:

```toml
title = "Harbour at dusk"
summary = "The fishing fleet coming home."
creator = "A. Painter"
date = "1890"
attribution = "Example Museum"
alt = "Fishing boats entering a harbour under an orange sky"
rights = "https://creativecommons.org/licenses/by/4.0/"
dimensions = "120 × 80 cm"
```

Click **Commit changes** and the site rebuilds itself. For a longer description, add a file called
`content/description.md` (written in [Markdown](https://commonmark.org/help/)).

- **Point at details:** zoom in on something on your site, copy **Link to this view**, and use it as a link in
  `description.md`: `[the lighthouse](https://…#xywh=1200,300,400,400)`. Clicking it takes the viewer there.
- **Other languages:** write any text like `title = { en = "Harbour", cy = "Harbwr" }`, and add
  `description.cy.md` next to `description.md`. Visitors see their own language and can switch.
- **rights** must be a Creative Commons or RightsStatements.org address; the address of the licence's own page,
  copied from your browser, is fine. Put any other terms in `attribution`.
- **creator** and **date** go into the details and the citation; **dimensions**, the real size of the original, gives
  the picture a scale bar.
- **Colours:** the page is black on white, or white on black for visitors whose computer is set to dark mode. To
  use your own colours in both, add a section like this (any CSS colour works):

  ```toml
  [colours]
  paper = "#fdf6e3" # the background
  ink = "#222222"   # text, lines, and the button that is selected
  ```

- Every setting is explained in [the template's own copy of the file](https://github.com/gjhilton/WhatIIIF/blob/main/content/whatiiif.toml),
  which may list settings that are newer than your copy.

## Share it

Under the picture on your site you will find, ready to copy:

- **Link to this view**: zoom into a detail first, and the link opens on exactly that.
- **Embed on a web page**: code that puts the zoomable picture into a blog post or another website.
- **Cite this view**: a citation of the view on screen, with that link in it.
- **Manifest URL**: paste it into any IIIF viewer, or use the links to open the picture in Mirador or Universal
  Viewer.

Under **Download** are the view on screen as a JPEG and, unless you switch them off, the full-size JPEG and the
original file.

## Going further: notes on the picture, and a tour

This is optional, and more work than the rest: your site is complete without it. When you want to, you can write
notes about parts of the picture. Each shows as a numbered marker on the picture and in a list under it, and in order
they make a tour that visitors step through, the viewer moving to each part in turn. See them on the
[notes demo](https://gjhilton.github.io/whatiiif-demo-notes/).

![The notes demo on its tour: a lighthouse in a drawing of a harbour, numbered markers on the picture, and below it the first of five notes, with Back and Next](engine/artwork/notes-demo.png)

1. On your site, zoom in on the part you want to write about, and copy **Link to this view**.
2. In your repository, open the **content** folder and choose **Add file → Create new file**. Call it `notes.md`.
3. Write each note as a heading that links to its part of the picture, followed by what you want to say. Anything
   before the first note introduces them:

   ```markdown
   Three things to look for.

   ## [The lighthouse](https://you.github.io/your-image/?viewer=openseadragon#xywh=1200,300,400,900)

   Built in 1846, and still lit.

   ## [The boats](https://you.github.io/your-image/?viewer=openseadragon#xywh=2400,1800,900,500)

   The fishing fleet, coming home.
   ```

4. Click **Commit changes**. The tour follows the notes in the order they are written.

For other languages, add `notes.cy.md` and so on, with the same notes in the same order; their headings need no
links, as the notes in `notes.md` say where each part is: `## Y goleudy`.

The notes are also written into the manifest, as IIIF annotations, so other IIIF viewers can show them: Mirador opens
with its own list of them, where there is room beside the picture.

## Change the picture

Delete the old file from the `content` folder, then upload the new one. The site holds one picture at a time, so
uploading the new one first stops the build until the old one is gone. For a picture given by its link, see
[Large pictures](#large-pictures). If you have [notes](#going-further-notes-on-the-picture-and-a-tour), their links
point at parts of the old picture, so copy them again from the new one; the build stops if one no longer fits.

## If something goes wrong

Open the **Actions** tab and click the run with a red cross. What went wrong is shown at the top of the run's page.
Most messages say what to fix; for some, this table says more:

| The error says | What to do |
|---|---|
| GitHub Pages is not enabled | Do step 2 above, then click **Re-run jobs**. |
| content/ must contain exactly one image | Delete the extra pictures from `content`. |
| … is not supported yet | Save the picture as TIFF, PNG or JPEG and upload that instead. |
| … is an iPhone photo (HEIC) | Make it a JPEG: on a Mac, open it in Preview and choose **File → Export**, then JPEG. |
| content/whatiiif.toml: … | Fix the setting it names; the message says how. |
| content/notes.md: … | Fix the note it names; the message says how. |
| Could not download the picture at … | Check the `picture` link: paste it into a private browser window, and it should download the picture. |
| Timeout reached, or Deployment cancelled | GitHub Pages was slow. Re-running may not help: make any small change, such as a line in `content/whatiiif.toml`, and commit it to start afresh. |

If nothing runs at all after you upload, check that the picture went into the **content** folder. A run that worked
may still list things **worth a look**, such as a file in `content` with a misspelt name, which the site does not use.
If you are stuck, [open an issue](https://github.com/gjhilton/WhatIIIF/issues).

## Large pictures

The browser cannot upload a picture of more than 25 MB into `content`, but it can upload one of up to 2 GB into a
release:

1. On your repository's **Code** tab, click **Releases** (on the right), then **Create a new release**.
2. In the tag box, type `picture` and choose to create it as a new tag. Give the release any title.
3. Drop the picture into the box at the bottom, wait for it to upload, and click **Publish release**.
4. On the release's page, right-click the picture's name under **Assets** and copy the link.
5. Open `content/whatiiif.toml`, add a line `picture = "…"` with that link between the quotes, and commit it. (The
   settings helper has a box for it, too.)

The site is built from the picture at the link, which is also where visitors download the original. To change the
picture, add the new one to the release under a different file name, and change the link to it: committing the new
link rebuilds the site.

If you use Git on your computer, you can instead commit the picture into `content/` as usual: your repository stores
pictures with [Git LFS](https://git-lfs.com), which handles files over GitHub's 100 MB limit. Free GitHub accounts
include 10 GiB of LFS storage and 10 GiB of downloads a month. Each rebuild downloads the picture once, and so does
each visitor who downloads the original; `[publish] original = false` in `content/whatiiif.toml` stops offering it.

## Keeping up to date

Your repository's workflows run steps kept in the WhatIIIF repository, at its latest release, so those improve by
themselves. Once a week an **Update** workflow checks for a new release of WhatIIIF and, if there is one, opens a
pull request in your repository with the rest: merge it to update. To let it do that, turn on **Settings → Actions →
General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. It never touches your
`content` folder. GitHub does not let it change the files in `.github/workflows`, so in the rare release that changes
one of yours, the pull request links to the new version and to yours, for you to copy it over by hand.

## No warranty

WhatIIIF is free software, provided "as is", without warranty of any kind, express or implied. Its authors are not
liable for any claim, damages or other liability arising from its use. The [MIT licence](LICENSE) gives these terms
in full. In particular:

- Keep your own copy of every picture you publish: nothing here backs anything up.
- You are responsible for having the right to publish what you upload, and for what your site says.
- A site depends on GitHub, whose services, limits and terms can change at any time.

---

Made by [Funeral Games](https://funeralgames.co.uk). MIT licence © g.j.hilton.

Working on WhatIIIF itself? See [DEVELOPING.md](DEVELOPING.md).
