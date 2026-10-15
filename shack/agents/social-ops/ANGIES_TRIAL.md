# Angie's free trial (Thursday shoot)

Hudson pitched the owner of Angie's (Cold Spring, NY) on Monday. The deal: Hudson comes in on Thursday at no cost, shoots photos and video of the place, and returns a finished content package to show what he (and this team) can do. Angie's Instagram, TikTok and Facebook already exist, but **nothing gets posted to them yet**. This is a sample package for the owner to approve.

## Where things are (Google Drive)
- `The Shack/Angie's/1 - Raw (drop photos and videos here)`: folder id `135ES_1QnMHb6aOjy9dECt3H4fTubD3Jz`
- `The Shack/Angie's/2 - Finished (Lumi puts edited content here)`: folder id `1vEAQUTHR-L5PeIcie_kZGFGNz65ZpZkc`

## Pipeline (`tools/studio.py`)
1. Download everything in the Raw folder (Google Drive `download_file_content`, base64) into `shack/private/social-ops/angies/raw/`. If a video is too large to come through the connector, list it and ask Hudson to attach it directly in the Claude session instead.
2. `python3 tools/studio.py review <raw> <review>`, then **look at every contact sheet and thumbnail** with the Read tool. Note the strongest moments (timestamps), the light, and what the place is about.
3. `python3 tools/studio.py photos <raw> <edited>` for the best 8–12 photos (`--names`).
4. Write 3 edit plans and render 3 vertical videos with `tools/studio.py reel` (on-screen text in plain words, no emoji):
   - **Reel 1, "the vibe"** (15–20 s): the space, the counter, people, the best-looking product. Fast cuts of 1.5–2.5 s each.
   - **Reel 2, "the hero product"** (10–15 s): one signature item from prep to finished, close-ups.
   - **Reel 3, "meet Angie's"** (15–25 s): the owner or staff at work, or a short line from the owner if he recorded one.
5. Write `captions.md`: for each reel and for a photo carousel (pick 5–8 photos in order), a caption, 5–10 local hashtags (#coldspringny #hudsonvalley …), the best posting time, and the platform mix (Reels plus TikTok plus Facebook).
6. Write `two-week-plan.md`: a simple 2-week calendar (3–4 posts a week) using this footage, showing what an ongoing service would look like.
7. Upload everything to the Finished folder: the 3 MP4s, the edited photos (feed and story crops), `captions.md`, `two-week-plan.md`. Then reply with the Drive link.

Rules: no posting to Angie's accounts, no DMs, nothing sent to the owner. Hudson shows the package himself. Don't add copyrighted music; suggest adding a trending sound in-app when posting.
