STAGE PARTNER – FIRST LOCAL VERSION

Files
-----
index.html   The page
styles.css   The layout and appearance
app.js       Script handling, audio recording and rehearsal logic

How to use
----------
1. Keep all three files in the same folder.
2. For the most reliable microphone permissions, run the local web server below
   and open http://localhost:8000 in Chrome or Edge. Avoid opening the file
   directly by double-clicking index.html (file://), as browser permissions can
   behave inconsistently there.
3. Paste a script using one character per line:
       JOHN: Where have you been?
       SARAH: I've been waiting.
4. Choose your character and click Prepare script.
5. For each other character's line, use Record snippet or Choose audio.
6. Click Start rehearsal.

Local storage
-------------
The script is saved in this browser's local storage. Audio recordings are saved
in this browser's IndexedDB. They do not upload to GitHub or any server.
Use the same browser and device to access the saved data. Clearing browser data
may remove your saved scripts and recordings.

Microphone and speech recognition
---------------------------------
Audio recording requires microphone permission. Browser speech recognition
works best in supported browsers such as desktop Chrome, and may use an online
speech service. It is not guaranteed to work in every browser or when opened
directly as a file.

Run a simple local web server from this folder (recommended):
  Windows:  py -m http.server 8000
  Mac:     python3 -m http.server 8000
Then open http://localhost:8000 in Chrome.

Current prototype notes
-----------------------
- Script format is CHARACTER: dialogue, one line per row.
- Each other-character line can have one audio snippet.
- The rehearsal plays every script line in order. A cue recording finishes,
  then the next line is shown; it no longer jumps over intervening characters.
- The microphone stream stays open while you record multiple snippets, so the
  browser should normally ask for permission once per session/site rather than
  for every line. You can revoke permission in your browser settings.
- If a cue has no recording, it displays the text and the “I've heard the cue”
  button advances to the next script line.
- Matching is a simple forgiving word-overlap check, not a full language model.
- The app is an early prototype; test it with a short scene first.

Latest rehearsal improvements
-----------------------------
- Speech listening now keeps a running transcript and automatically restarts
  Chrome recognition if it stops after silence. You can pause dramatically and
  press Finish line when you have completed the whole line.
- The app requests microphone permission once and keeps the microphone stream
  available for the current page session. Chrome should remember permission
  for http://localhost:8000. If it asks repeatedly, click the site controls icon
  beside the address bar, open Site settings, set Microphone to Allow, and
  reload the page.
- Speech recognition is still provided by Chrome and may use Google's online
  speech service. Recognition quality can vary with background noise, accent,
  microphone quality and network connection. It is not an acting-performance
  judge; use the manual skip/continue controls if it mishears you.
