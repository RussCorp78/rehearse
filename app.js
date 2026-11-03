(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DB_NAME = "stagePartnerAudio";
  const STORE = "recordings";
  let lines = [];
  let playName = "";
  let myCharacter = "";
  let currentIndex = 0;
  let recognition = null;
  let mediaRecorder = null;
  let recordingStream = null;
  let activeRecordingLine = null;
  let audioPlayer = null;
  let listening = false;
  let spokenTranscript = "";
  let speechRestartTimer = null;

  const panels = ["setupPanel", "linesPanel", "rehearsalPanel"];
  function showPanel(id) { panels.forEach(p => $(p).classList.toggle("hidden", p !== id)); }
  function normalise(s) {
    return (s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function parseScript(raw) {
    const parsed = [];
    raw.split(/\r?\n/).forEach((row, index) => {
      const trimmed = row.trim();
      if (!trimmed) return;
      const match = trimmed.match(/^([^:]{1,45}):\s*(.+)$/);
      if (!match) throw new Error(`Line ${index + 1} needs to look like CHARACTER: dialogue`);
      parsed.push({ speaker: match[1].trim(), text: match[2].trim(), audioKey: `line-${parsed.length}` });
    });
    if (!parsed.length) throw new Error("Paste at least one script line.");
    return parsed;
  }
  function characters() { return [...new Set(lines.map(l => l.speaker))]; }

  $("prepareBtn").addEventListener("click", () => {
    try {
      lines = parseScript($("scriptInput").value);
      const chars = characters();
      const previous = $("characterSelect").value;
      $("characterSelect").innerHTML = chars.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      if (chars.includes(previous)) $("characterSelect").value = previous;
      $("setupMessage").textContent = `Found ${lines.length} lines and ${chars.length} characters. Choose your character, then prepare again.`;
      if (!chars.includes(previous)) {
        $("characterSelect").focus();
        return;
      }
      prepareLines();
    } catch (err) { $("setupMessage").textContent = err.message; }
  });
  $("characterSelect").addEventListener("change", () => {
    if (lines.length) prepareLines();
  });
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }
  function prepareLines() {
    myCharacter = $("characterSelect").value;
    if (!myCharacter || !lines.length) return;
    playName = $("playName").value.trim() || "Untitled scene";
    $("currentPlayTitle").textContent = playName;
    $("rehearsalTitle").textContent = playName;
    renderLineList();
    showPanel("linesPanel");
  }
  async function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveAudio(key, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  async function getAudio(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }
  async function deleteAudio(key) {
    const db = await openDB();
    return new Promise(resolve => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
    });
  }
  async function renderLineList() {
    const list = $("lineList");
    list.innerHTML = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const item = document.createElement("article");
      item.className = `line-item ${line.speaker === myCharacter ? "mine" : ""}`;
      item.innerHTML = `<div class="line-top"><span class="line-speaker">${escapeHtml(line.speaker)}${line.speaker === myCharacter ? " · YOUR LINE" : ""}</span><span class="help">Line ${i + 1}</span></div>
        <p class="line-dialogue">${escapeHtml(line.text)}</p>`;
      if (line.speaker !== myCharacter) {
        const controls = document.createElement("div");
        controls.className = "record-controls";
        controls.innerHTML = `<button class="secondary record-btn">Record snippet</button>
          <label class="file-label">Choose audio<input type="file" accept="audio/*"></label>
          <button class="text-button clear-audio">Clear audio</button>`;
        const recordBtn = controls.querySelector(".record-btn");
        recordBtn.addEventListener("click", () => toggleRecording(i, recordBtn));
        controls.querySelector("input").addEventListener("change", async (e) => {
          const file = e.target.files[0];
          if (file) {
            await saveAudio(line.audioKey, file);
            $("recordingMessage").textContent = `Saved recording for ${line.speaker}'s line ${i + 1}.`;
            renderLineList();
          }
        });
        controls.querySelector(".clear-audio").addEventListener("click", async () => {
          await deleteAudio(line.audioKey); $("recordingMessage").textContent = "Recording removed."; renderLineList();
        });
        item.appendChild(controls);
        const blob = await getAudio(line.audioKey);
        if (blob) {
          const audio = document.createElement("audio");
          audio.controls = true; audio.src = URL.createObjectURL(blob);
          item.appendChild(audio);
        } else {
          const note = document.createElement("p"); note.className = "help"; note.textContent = "No recording yet – this cue will be shown as text."; item.appendChild(note);
        }
      }
      list.appendChild(item);
    }
  }
  async function toggleRecording(index, button) {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop(); button.textContent = "Record snippet"; return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      $("recordingMessage").textContent = "Audio recording is not supported in this browser. Use Choose audio instead.";
      return;
    }
    try {
      // Keep one microphone stream open while recording several snippets.
      // This avoids repeatedly requesting microphone access for every line.
      if (!recordingStream || recordingStream.getTracks().every(track => track.readyState === "ended")) {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const chunks = [];
      const recorder = new MediaRecorder(recordingStream);
      mediaRecorder = recorder;
      activeRecordingLine = index;
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        await saveAudio(lines[index].audioKey, blob);
        // Leave the stream available for the next snippet. It is released
        // when the page is closed (see the pagehide handler below).
        if (mediaRecorder === recorder) mediaRecorder = null;
        $("recordingMessage").textContent = `Recording saved for line ${index + 1}.`;
        renderLineList();
      };
      mediaRecorder.start();
      button.textContent = "Stop recording";
      $("recordingMessage").textContent = "Recording… speak the other character's line, then press Stop recording.";
    } catch (err) {
      $("recordingMessage").textContent = `Could not access microphone: ${err.message}`;
    }
  }
  $("saveScriptBtn").addEventListener("click", () => {
    const data = { playName, myCharacter, lines };
    localStorage.setItem("stagePartnerScript", JSON.stringify(data));
    $("recordingMessage").textContent = "Script saved in this browser. Audio snippets are saved separately in this browser.";
  });
  $("loadBtn").addEventListener("click", () => {
    const saved = localStorage.getItem("stagePartnerScript");
    if (!saved) { $("setupMessage").textContent = "No saved script found in this browser yet."; return; }
    try {
      const data = JSON.parse(saved);
      $("playName").value = data.playName || "";
      $("scriptInput").value = data.lines.map(l => `${l.speaker}: ${l.text}`).join("\n");
      lines = data.lines;
      const chars = characters();
      $("characterSelect").innerHTML = chars.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      $("characterSelect").value = data.myCharacter || chars[0];
      prepareLines();
      $("setupMessage").textContent = "Saved script loaded.";
    } catch { $("setupMessage").textContent = "The saved script could not be read."; }
  });
  $("backToSetupBtn").addEventListener("click", () => showPanel("setupPanel"));
  $("startRehearsalBtn").addEventListener("click", () => {
    currentIndex = 0; showPanel("rehearsalPanel"); showCurrentLine();
  });
  $("endRehearsalBtn").addEventListener("click", () => { stopListening(); showPanel("linesPanel"); });
  async function showCurrentLine() {
    stopListening();
    if (currentIndex >= lines.length) { finishScene(); return; }
    const line = lines[currentIndex];
    $("progressLabel").textContent = `Line ${currentIndex + 1} of ${lines.length}`;
    $("progressBar").style.width = `${((currentIndex + 1) / lines.length) * 100}%`;
    $("cueSpeaker").textContent = line.speaker;
    $("cueText").textContent = line.speaker === myCharacter ? "Your turn." : line.text;
    $("cueHint").textContent = "";
    $("recognisedText").textContent = "";
    $("feedback").textContent = "";
    if (line.speaker === myCharacter) {
      $("responsePrompt").textContent = "Say your line when you're ready.";
      $("listenBtn").disabled = false;
      $("listenBtn").textContent = "Start listening";
    } else {
      $("responsePrompt").textContent = "Listen to the cue…";
      $("listenBtn").disabled = true;
      $("listenBtn").textContent = "Waiting for your cue";
      const blob = await getAudio(line.audioKey);
      if (blob) {
        if (audioPlayer) { audioPlayer.pause(); URL.revokeObjectURL(audioPlayer.src); }
        audioPlayer = new Audio(URL.createObjectURL(blob));
        audioPlayer.onended = () => advanceOneLine();
        audioPlayer.onerror = () => { $("feedback").textContent = "Couldn't play this recording. You can skip the cue."; };
        audioPlayer.play().catch(() => { $("feedback").textContent = "Press Repeat cue to play the recording."; });
      } else {
        $("cueHint").textContent = "No recording attached. Read this cue, then continue to your line.";
        $("listenBtn").disabled = false;
        $("listenBtn").textContent = "I've heard the cue";
      }
    }
  }
  function advanceOneLine() {
    currentIndex++;
    showCurrentLine();
  }
  async function finishScene() {
    stopListening();
    $("cueSpeaker").textContent = "SCENE COMPLETE";
    $("cueText").textContent = "Well done. You've reached the end of this scene.";
    $("responsePrompt").textContent = "Rehearsal finished";
    $("recognisedText").textContent = "";
    $("feedback").textContent = "You can restart the scene or return to your recordings.";
    $("listenBtn").disabled = true;
    $("progressBar").style.width = "100%";
    $("progressLabel").textContent = `${lines.length} lines completed`;
  }
  $("listenBtn").addEventListener("click", () => {
    const line = lines[currentIndex];
    if (line && line.speaker !== myCharacter) { advanceOneLine(); return; }
    startListening();
  });
  async function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $("feedback").textContent = "Speech recognition isn't available here. You can use the hint, then continue manually.";
      $("feedback").className = "feedback error";
      return;
    }
    stopListening();
    spokenTranscript = "";
    listening = true;
    $("listenBtn").disabled = true;
    $("listenBtn").textContent = "Listening…";
    $("finishLineBtn").hidden = false;
    $("finishLineBtn").disabled = false;
    $("feedback").textContent = "Speak naturally. Pauses are fine – press Finish line when you've finished.";
    $("feedback").className = "feedback";
    try {
      // Request microphone permission once and retain the stream for this page session.
      // SpeechRecognition is a separate browser API, but the site permission is shared in Chrome.
      if (navigator.mediaDevices?.getUserMedia && (!recordingStream || recordingStream.getTracks().every(t => t.readyState === "ended"))) {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (!listening) return;
      startRecognitionSession(SpeechRecognition);
    } catch (err) {
      listening = false;
      $("listenBtn").disabled = false;
      $("listenBtn").textContent = "Try listening again";
      $("finishLineBtn").hidden = true;
      $("feedback").textContent = `Microphone access failed: ${err.message}. In Chrome, allow Microphone for localhost using the icon beside the address bar, then try again.`;
      $("feedback").className = "feedback error";
    }
  }
  function startRecognitionSession(SpeechRecognition) {
    if (!listening) return;
    const session = new SpeechRecognition();
    recognition = session;
    session.lang = "en-GB";
    session.continuous = true;
    session.interimResults = true;
    session.maxAlternatives = 1;
    session.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        if (result.isFinal && transcript) spokenTranscript += (spokenTranscript ? " " : "") + transcript;
        else interim += (interim ? " " : "") + transcript;
      }
      $("recognisedText").textContent = (spokenTranscript + " " + interim).trim();
    };
    session.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        listening = false;
        $("finishLineBtn").hidden = true;
        $("listenBtn").disabled = false;
        $("listenBtn").textContent = "Try listening again";
        $("feedback").textContent = "Chrome has blocked microphone access. Allow it for localhost in the address-bar site settings.";
        $("feedback").className = "feedback error";
      } else {
        $("feedback").textContent = `Speech recognition issue: ${event.error}. Your captured words have been kept; try again or finish the line.`;
        $("feedback").className = "feedback error";
      }
    };
    session.onend = () => {
      if (recognition !== session || !listening) return;
      // Chrome may end a recognition session after silence. Restart it and keep
      // the transcript accumulated so far, so dramatic pauses don't lose the line.
      speechRestartTimer = setTimeout(() => startRecognitionSession(SpeechRecognition), 300);
    };
    try { session.start(); }
    catch {
      if (listening) speechRestartTimer = setTimeout(() => startRecognitionSession(SpeechRecognition), 500);
    }
  }
  function stopListening() {
    listening = false;
    if (speechRestartTimer) { clearTimeout(speechRestartTimer); speechRestartTimer = null; }
    if (recognition) { const old = recognition; recognition = null; try { old.stop(); } catch {} }
    $("finishLineBtn").hidden = true;
  }
  function finishListening() {
    if (!listening) return;
    stopListening();
    $("listenBtn").disabled = false;
    $("listenBtn").textContent = "Try listening again";
    if (spokenTranscript.trim()) checkLine(spokenTranscript.trim());
    else {
      $("feedback").textContent = "I didn't catch any words. Try again, speaking naturally and a little closer to the microphone.";
      $("feedback").className = "feedback error";
    }
  }
  $("finishLineBtn").addEventListener("click", finishListening);
  function similarity(a, b) {
    const aa = normalise(a).split(" ").filter(Boolean);
    const bb = normalise(b).split(" ").filter(Boolean);
    if (!aa.length || !bb.length) return 0;
    // Word overlap with a small allowance for recognition errors and omitted words.
    const remaining = [...bb];
    let matched = 0;
    aa.forEach(word => {
      const exact = remaining.indexOf(word);
      if (exact >= 0) { matched++; remaining.splice(exact, 1); }
      else {
        const near = remaining.findIndex(w => w.length > 4 && word.length > 4 &&
          (w.startsWith(word.slice(0, 4)) || word.startsWith(w.slice(0, 4))));
        if (near >= 0) { matched += 0.7; remaining.splice(near, 1); }
      }
    });
    const recall = matched / bb.length;
    const precision = matched / Math.max(aa.length, bb.length);
    return (recall * 0.75) + (precision * 0.25);
  }
  function checkLine(spoken) {
    const line = lines[currentIndex];
    const score = similarity(spoken, line.text);
    const mode = $("strictness").value;
    const threshold = mode === "loose" ? 0.58 : mode === "strict" ? 0.88 : 0.73;
    if (score >= threshold) {
      $("feedback").textContent = "That's close enough – moving on!";
      $("feedback").className = "feedback";
      stopListening();
      setTimeout(() => { currentIndex++; showCurrentLine(); }, 900);
    } else {
      $("feedback").textContent = `Not quite yet. Your line is ${Math.round(score * 100)}% matched. Try again, or ask for a hint.`;
      $("feedback").className = "feedback error";
      $("listenBtn").disabled = false;
      $("listenBtn").textContent = "Try again";
    }
  }
  $("hintBtn").addEventListener("click", () => {
    const line = lines[currentIndex];
    if (!line || line.speaker !== myCharacter) return;
    const words = line.text.split(/\s+/);
    $("cueHint").textContent = `Hint: ${words.slice(0, Math.min(4, words.length)).join(" ")}…`;
  });
  $("repeatBtn").addEventListener("click", async () => {
    const line = lines[currentIndex];
    if (!line || line.speaker === myCharacter) { $("feedback").textContent = "You're on your own line."; return; }
    const blob = await getAudio(line.audioKey);
    if (!blob) { $("feedback").textContent = "There isn't a recording for this cue yet."; return; }
    if (audioPlayer) audioPlayer.pause();
    audioPlayer = new Audio(URL.createObjectURL(blob));
    audioPlayer.onended = advanceOneLine;
    audioPlayer.play();
  });
  $("skipBtn").addEventListener("click", () => {
    stopListening();
    currentIndex++;
    showCurrentLine();
  });
  $("restartBtn").addEventListener("click", () => { currentIndex = 0; showCurrentLine(); });

  // Release the microphone when the rehearsal page is closed or refreshed.
  window.addEventListener("pagehide", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      try { mediaRecorder.stop(); } catch {}
    }
    if (recordingStream) {
      recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
    }
  });

  // Populate character list on first load using the example script.
  try {
    lines = parseScript($("scriptInput").value);
    $("characterSelect").innerHTML = characters().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    $("characterSelect").value = characters()[1] || characters()[0];
    $("setupMessage").textContent = "Example script loaded. Replace it with your own when ready.";
  } catch {}
})();
