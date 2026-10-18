/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import "./audio-visualizer.js";
import "./live-transcript.js";
import {
  GeminiLiveAPI,
  MultimodalLiveResponseType,
  FunctionCallDefinition,
} from "../lib/gemini-live/geminilive.js";
import { AudioStreamer, AudioPlayer } from "../lib/gemini-live/mediaUtils.js";

class ViewChat extends HTMLElement {
  constructor() {
    super();
    this._mission = null;
  }

  set mission(value) {
    this._mission = value;
    this.render();
  }

  set language(value) {
    this._language = value;
  }

  set fromLanguage(value) {
    this._fromLanguage = value;
  }

  set mode(value) {
    this._mode = value;
  }

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    clearTimeout(this.wrapUpTimer);
    clearTimeout(this.sessionTimer);
    clearTimeout(this.completionTimer);
    if (this.audioPlayer) this.audioPlayer.interrupt();
    if (this.audioStreamer) this.audioStreamer.stop();
    if (this.client) this.client.disconnect();
  }

  render() {
    if (!this._mission) return; // Wait for mission prop

    this.innerHTML = `

 <button id="back-to-missions" style="
            position: absolute;
            top: var(--spacing-md);
            left: var(--spacing-md);
            background: transparent;
            float: left;
            border: none;
            cursor: pointer;
            padding: 8px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            opacity: 0.7;
            transition: opacity 0.2s;
            z-index: 10;
        " onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>

      <div class="container" style="justify-content: space-between; min-height: 100vh; position: relative; padding-bottom: var(--spacing-xl);">
        
       

        <div style="margin-top: var(--spacing-xl); text-align: center;">
          <h2 style="font-size: 1.5rem; margin-bottom: 2px;">${this._mission.target_role || "Target Person"
      }</h2>
          
          <!-- Language Visibility Pill -->
          <div style="
            font-size: 0.85rem; 
            font-weight: 700; 
            color: var(--color-text-sub);
            margin-bottom: var(--spacing-md);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: rgba(0,0,0,0.04);
            padding: 4px 12px;
            border-radius: var(--radius-full);
            width: fit-content;
            margin-left: auto;
            margin-right: auto;
            border: 1px solid rgba(0,0,0,0.05);
          ">
            <span>${this._fromLanguage}</span>
            <span style="opacity: 0.3; font-weight: normal;">➔</span>
            <span style="color: var(--color-accent-primary);">${this._language}</span>
          </div>

          <div style="
            border-radius: var(--radius-lg);
            padding: var(--spacing-md) var(--spacing-lg);
            display: inline-block;
            margin-top: var(--spacing-md);
            max-width: 800px;
          ">
            <p style="font-size: 1.2rem; font-weight: bold; color: var(--color-accent-secondary); margin: 0;">${this._mission.title
      }</p>
            <p style="font-size: 1rem; opacity: 0.9; margin-top: 4px;">${this._mission.desc
      }</p>
          </div>
          ${this._mode === "immergo_teacher"
        ? `
          <div style="
            margin-top: var(--spacing-lg); 
            font-size: 0.9rem; 
            background: var(--color-surface); 
            color: var(--color-accent-primary); 
            padding: 8px 16px; 
            border-radius: var(--radius-full); 
            display: inline-flex; 
            align-items: center; 
            gap: 6px;
            border: 1px solid var(--color-accent-primary);
            box-shadow: var(--shadow-sm);
          ">
            <span>You can ask for <strong>translations</strong> & <strong>explanations</strong> at any time.</span>
          </div>
          `
        : ""
      }
        </div>

        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: ${this._mode === "immergo_teacher" ? "space-between" : "center"
      }; width: 100%; gap: ${this._mode === "immergo_teacher" ? "10px" : "40px"
      };">
          <!-- Model Visualizer (Top) -->
          <div style="width: 100%; height: 120px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
             <audio-visualizer id="model-viz"></audio-visualizer>
          </div>
          
          <!-- Transcript (Middle) -->
          ${this._mode === "immergo_teacher"
        ? `
            <div style="width: 100%; height: 250px; margin: 10px 0; position: relative;">
              <live-transcript></live-transcript>
            </div>
          `
        : ""
      }

          <!-- User Visualizer (Bottom) -->
           <div style="width: 100%; height: 120px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
             <audio-visualizer id="user-viz"></audio-visualizer>
          </div>
        </div>

        <style>
          .chat-cta-btn {
            background: var(--color-accent-primary);
            color: white;
            padding: 24px 48px;
            border-radius: var(--radius-lg);
            width: auto;
            min-width: 280px;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5),
                        0 0 0 1px rgba(255,255,255,0.2) inset;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10;
            transition: all 0.4s cubic-bezier(0.19, 1, 0.22, 1);
            position: relative;
            overflow: hidden;
            font-family: var(--font-body);
          }

          .chat-cta-btn:hover {
            transform: translateY(-5px) scale(1.02);
            filter: brightness(1.1);
            box-shadow: 0 20px 40px -10px rgba(163, 177, 138, 0.4),
                        0 0 0 2px rgba(255,255,255,0.3) inset;
          }

          .chat-cta-btn:active {
            transform: translateY(-2px) scale(0.98);
          }

          .chat-cta-btn::after {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 200%; height: 100%;
            background: linear-gradient(115deg, transparent 0%, transparent 45%, rgba(255, 255, 255, 0.3) 50%, transparent 55%, transparent 100%);
            transform: translateX(-150%) skewX(-15deg);
            transition: transform 0.6s;
          }

          .chat-cta-btn:hover::after {
            transform: translateX(150%) skewX(-15deg);
          }

          .chat-cta-btn.active {
            background: var(--color-danger) !important;
            flex-direction: row !important;
            gap: 12px;
          }
        </style>

        <div style="margin-bottom: var(--spacing-xxl); display: flex; flex-direction: column; gap: var(--spacing-lg); align-items: center;">
           
           <button id="mic-btn" class="chat-cta-btn">
            <span style="font-size: 1.3rem; font-weight: 800; margin-bottom: 2px; letter-spacing: 0.02em;">Start Mission</span>
            <span style="font-size: 0.85rem; opacity: 0.9; font-style: italic;">You start the conversation!</span>
          </button>

           <p id="connection-status" style="
             margin-top: var(--spacing-sm);
             font-size: 0.9rem;
             font-weight: 700;
             height: 1.2em;
             transition: all 0.3s ease;
             letter-spacing: 0.05em;
             text-transform: uppercase;
           "></p>
        </div>

        <!-- Rate Limit Dialog -->
        <div id="rate-limit-dialog" class="hidden" style="
            position: fixed; inset: 0; 
            background: rgba(0,0,0,0.8); 
            backdrop-filter: blur(4px);
            z-index: 20;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
        ">
            <div style="background: white; color: var(--color-text-primary); padding: var(--spacing-xl); border-radius: var(--radius-lg); max-width: 500px; text-align: center; box-shadow: var(--shadow-lg);">
                <h3 style="margin-bottom: var(--spacing-md); color: var(--color-accent-primary);">Opps, this is too popular!</h3>
                <p style="margin-bottom: var(--spacing-lg); line-height: 1.5;">
                    The global quota has been reached. But you can skip the queue by deploying your own version on Google Cloud Run!
                </p>
                <div style="display: flex; flex-direction: column; gap: var(--spacing-md); margin-bottom: var(--spacing-lg);">
                     <a href="https://deploy.cloud.run/?git_repo=https://github.com/ZackAkil/immersive-language-learning-with-live-api&utm_source=github&utm_medium=unpaidsoc&utm_campaign=FY-Q1-global-cloud-ai-starter-apps&utm_content=immergo-app&utm_term=-" target="_blank" style="
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 12px;
                        padding: 16px 32px;
                        border-radius: var(--radius-md);
                        color: #1a73e8;
                        background: rgba(26, 115, 232, 0.05);
                        text-decoration: none;
                        font-weight: 800;
                        box-shadow: 0 4px 15px rgba(26, 115, 232, 0.1);
                        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                        font-size: 1.1rem;
                        white-space: nowrap;
                        border: 2px dashed #1a73e8;
                     " onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 8px 25px rgba(26, 115, 232, 0.2)'; this.style.background='rgba(26, 115, 232, 0.1)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(26, 115, 232, 0.1)'; this.style.background='rgba(26, 115, 232, 0.05)';" >
                        <img src="https://www.gstatic.com/images/branding/product/1x/google_cloud_48dp.png" width="24" height="24" alt="Cloud Run Logo" />
                        Deploy to Cloud Run
                     </a>
                </div>
                <button id="close-rate-limit" style="
                    background: var(--color-accent-primary);
                    color: white;
                    border: none;
                    padding: var(--spacing-sm) var(--spacing-xl);
                    border-radius: var(--radius-full);
                    cursor: pointer;
                    font-weight: bold;
                ">Got it</button>
            </div>
        </div>

      </div>
    `;

    const rateLimitDialog = this.querySelector("#rate-limit-dialog");
    const closeRateLimitBtn = this.querySelector("#close-rate-limit");

    closeRateLimitBtn.addEventListener("click", () => {
      rateLimitDialog.classList.add("hidden");
      rateLimitDialog.style.display = "none";
    });

    // Helper to perform navigation
    const doEndSession = () => {
      // Cleanup Gemini session
      if (this.audioStreamer) this.audioStreamer.stop();
      if (this.client) this.client.disconnect();
      if (this.audioPlayer) this.audioPlayer.interrupt(); // Stop playback

      // Disconnect visualizers
      const userViz = this.querySelector("#user-viz");
      const modelViz = this.querySelector("#model-viz");
      if (userViz && userViz.disconnect) userViz.disconnect();
      if (modelViz && modelViz.disconnect) modelViz.disconnect();

      console.log("👋 [App] Session ended by user");

      // Incomplete session
      const result = {
        incomplete: true,
      };

      this.dispatchEvent(
        new CustomEvent("navigate", {
          bubbles: true,
          detail: { view: "summary", result: result },
        })
      );
    };

    const requestWrapUp = () => {
      if (this.ending) return;
      this.ending = true;
      micBtn.disabled = true;
      statusEl.textContent = "Finishing and saving feedback…";
      this.client.sendTextMessage("I want to finish now. Save a brief evidence-based progress checkpoint with a next exercise, then call complete_mission with feedback. Do not invent progress if we have not practised.");
      this.wrapUpTimer = setTimeout(doEndSession, 20000);
    };

    // Back Button
    const backBtn = this.querySelector("#back-to-missions");
    backBtn.addEventListener("click", () => {
      // Stop session if active
      if (this.audioStreamer) this.audioStreamer.stop();
      if (this.client) this.client.disconnect();
      if (this.audioPlayer) this.audioPlayer.interrupt();

      const userViz = this.querySelector("#user-viz");
      const modelViz = this.querySelector("#model-viz");
      if (userViz && userViz.disconnect) userViz.disconnect();
      if (modelViz && modelViz.disconnect) modelViz.disconnect();

      // Navigate back to mission selector
      this.dispatchEvent(
        new CustomEvent("navigate", {
          bubbles: true,
          detail: { view: "mission-selector" },
        })
      );
    });

    // Animate visualizer on click
    const userViz = this.querySelector("#user-viz");
    const modelViz = this.querySelector("#model-viz");
    const micBtn = this.querySelector("#mic-btn");
    const statusEl = this.querySelector("#connection-status");
    let isSpeaking = false;

    // Initialize Gemini Live
    this.client = new GeminiLiveAPI();
    this.client.openConversation = this._mission?.open_conversation === true;
    this.audioStreamer = new AudioStreamer(this.client);
    this.audioPlayer = new AudioPlayer();

    // Define Mission Complete Tool
    const completeMissionTool = new FunctionCallDefinition(
      "complete_mission",
      "Call this tool when the user has successfully completed the mission objective. Provide a score and feedback.",
      {
        type: "OBJECT",
        properties: {
          score: {
            type: "INTEGER",
            description:
              "Rating from 1 to 3 based on performance: 1 (Tiro) = Struggled, used frequent English, or needed many hints. 2 (Proficiens) = Good, intelligible but with errors or hesitation. 3 (Peritus) = Excellent, fluent, native-like, no help needed.",
          },
          feedback_pointers: {
            type: "ARRAY",
            items: { type: "STRING" },
            description:
              "List of 3 constructive feedback points or compliments in English.",
          },
        },
        required: ["score", "feedback_pointers"],
      },
      ["score", "feedback_pointers"]
    );

    completeMissionTool.functionToCall = (args) => {
      clearTimeout(this.wrapUpTimer);
      console.log("🏆 [App] Mission Complete Tool Triggered!");

      // Play winner sound immediately
      const winnerSound = new Audio("/winner-bell.mp3");
      winnerSound.volume = 0.6;
      winnerSound
        .play()
        .catch((e) => console.error("Failed to play winner sound:", e));

      // Map score to level
      const levels = { 1: "Tiro", 2: "Proficiens", 3: "Peritus" };
      const level = levels[args.score] || "Proficiens";

      console.log(
        "⏳ [App] Waiting for final audio to play before ending session..."
      );

      // Delay cleanup to allow the agent's congratulatory message to be heard
      this.completionTimer = setTimeout(() => {
        if (!this.isConnected) return;
        // Cleanup
        if (this.audioStreamer) this.audioStreamer.stop();
        if (this.client) this.client.disconnect();
        if (this.audioPlayer) this.audioPlayer.interrupt();

        // Navigate to summary
        const result = {
          score: args.score.toString(),
          level: level,
          notes: args.feedback_pointers,
        };

        this.dispatchEvent(
          new CustomEvent("navigate", {
            bubbles: true,
            detail: { view: "summary", result: result },
          })
        );
      }, 2500); // 2.5 seconds delay
    };

    this.client.addFunction(completeMissionTool);

    // Setup client callbacks for logging
    this.client.onConnectionStarted = () => {
      console.log("🚀 [Gemini] Connection started");
    };

    this.client.onOpen = () => {
      console.log("🔓 [Gemini] WebSocket connection opened");
    };

    this.client.onReceiveResponse = (response) => {
      console.log("📥 [Gemini] Received response:", response.type);
      if (response.type === MultimodalLiveResponseType.SETUP_COMPLETE) {
        if (this._mission.open_conversation) this.sessionTimer = setTimeout(requestWrapUp, Math.max(5000, ((this.client.sessionTimeLimit || 600) - 30) * 1000));
      } else if (response.type === MultimodalLiveResponseType.INTERRUPTED) {
        this.audioPlayer.interrupt();
      } else if (response.type === MultimodalLiveResponseType.AUDIO) {
        this.audioPlayer.play(response.data);
      } else if (response.type === MultimodalLiveResponseType.TURN_COMPLETE) {
        console.log("✅ [Gemini] Turn complete");
        const transcriptEl = this.querySelector("live-transcript");
        if (transcriptEl) {
          transcriptEl.finalizeAll();
        }
      } else if (response.type === MultimodalLiveResponseType.TOOL_CALL) {
        console.log("🛠️ [Gemini] Tool Call received:", response.data);
        if (response.data.functionCalls) {
          response.data.functionCalls.forEach((fc) => {
            this.client.callFunction(fc.name, fc.args);
          });
        }
      } else if (
        response.type === MultimodalLiveResponseType.INPUT_TRANSCRIPTION
      ) {
        const transcriptEl = this.querySelector("live-transcript");
        if (transcriptEl) {
          transcriptEl.addInputTranscript(
            response.data.text,
            response.data.finished
          );
        }
      } else if (
        response.type === MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION
      ) {
        const transcriptEl = this.querySelector("live-transcript");
        if (transcriptEl) {
          transcriptEl.addOutputTranscript(
            response.data.text,
            response.data.finished
          );
        }
      }
    };

    this.client.onError = (error) => {
      console.error("❌ [Gemini] Error:", error);
    };

    this.client.onClose = () => {
      clearTimeout(this.sessionTimer);
      if (this.audioStreamer) this.audioStreamer.stop();
      if (this.audioPlayer) this.audioPlayer.interrupt();
      if (!this.ending) statusEl.textContent = "Session closed. Return to your practice page to continue.";
      console.log("🔒 [Gemini] Connection closed");
    };

    micBtn.addEventListener("click", async () => {
      isSpeaking = !isSpeaking;

      if (isSpeaking) {
        micBtn.classList.add('active');
        // Change to Stop/Listening state
        micBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
            <span style="font-weight: 800; font-size: 1.1rem; letter-spacing: 0.05em; text-transform: uppercase;">End Mission</span>
        `;
      } else {
        // Was active, so stopping now
        micBtn.classList.remove('active');
        if (this._mission.open_conversation) requestWrapUp();
        else doEndSession();
        return; // Stop here, don't execute start logic
      }

      if (isSpeaking) {
        console.log("🎙️ [App] Microphone button clicked: Starting session...");
        statusEl.textContent = "Connecting...";
        statusEl.style.color = "var(--color-text-sub)";
        // Viz active handled by connection now

        try {
          // 0. Configure System Instructions
          const language = this._language || "French";
          const fromLanguage = this._fromLanguage || "English";
          const mode = this._mode || "immergo_immersive";
          const missionTitle = this._mission
            ? this._mission.title
            : "General Conversation";
          const missionDesc = this._mission ? this._mission.desc : "";
          const targetRole = this._mission
            ? this._mission.target_role || "a local native speaker"
            : "a conversational partner";

          let systemInstruction = "";

          if (mode === "immergo_teacher") {
            // Teacher Mode Prompt
            systemInstruction = `
ROLEPLAY INSTRUCTION:
You are acting as **${targetRole}**, a native speaker of ${language}.
The user is a language learner (native speaker of ${fromLanguage}) trying to: "${missionTitle}" (${missionDesc}).
Your goal is to be a PROACTIVE LANGUAGE MENTOR while staying in character as ${targetRole}.

TEACHING PROTOCOL:
1. **Gentle Corrections**: If the user makes a clear mistake, respond in character first, then briefly provide a friendly correction or a "more natural way to say that" in ${fromLanguage}.
2. **Vocabulary Boost**: Every few turns, suggest 1-2 relevant words or idioms in ${language} that fit the current situation and explain their meaning in ${fromLanguage}.
3. **Mini-Checks**: Occasionally (every 3-4 turns), ask the user a quick "How would you say...?" question in ${fromLanguage} related to the mission to test their recall.
4. **Scaffolding**: If the user is hesitant, provide the start of a sentence in ${language} or give them two options to choose from to keep the momentum.
5. **Mixed-Language Support**: Use ${fromLanguage} for teaching moments, but always pivot back to ${language} to maintain the immersive feel.

INTERACTION GUIDELINES:
1. Prioritize the flow of conversation—don't let the teaching feel like a lecture.
2. Utilize the proactive audio feature: do not respond until the user has clearly finished their thought.

MISSION COMPLETION:
When the user has successfully achieved the mission objective:
1. Give a warm congratulatory message in ${language}, then translate the praise into ${fromLanguage}.
2. THEN call the "complete_mission" tool.
3. Set 'score' to 0 (Zero) as this is a learning-focused practice session.
4. Provide 3 specific takeaways (grammar tips or new words) in the feedback list in ${fromLanguage}.
`;
          } else {
            // Immersive Mode Prompt (Default)
            systemInstruction = `
ROLEPLAY INSTRUCTION:
You are acting as **${targetRole}**, a native speaker of ${language}.
The user is a language learner (native speaker of ${fromLanguage}) trying to: "${missionTitle}" (${missionDesc}).
Your goal is to play your role (${targetRole}) naturally. Do not act as an AI assistant. Act as the person.
Speak in the accent and tone of the role.

INTERACTION GUIDELINES:
1. It is up to you if you want to directly speak back, or speak out what you think the user is saying in your native language before responding.
2. Utilising the proactive audio feature, do not respond until it is necessary (i.e. the user has finished their turn).
3. Be helpful but strict about language practice. It is just like speaking to a multilingual person.
4. You cannot proceed without the user speaking the target language (${language}) themselves.
5. If you need to give feedback, corrections, or translations, use the user's native language (${fromLanguage}).

NO FREE RIDES POLICY:
If the user asks for help in ${fromLanguage} (e.g., "please can you repeat"), you MUST NOT simply answer.
Instead, force them to say the phrase in the target language (${language}).
For example, say: "You mean to say [Insert Translation in ${language}]" (provided in ${fromLanguage}) and wait for them to repeat it.
Do not continue the conversation until they attempt the phrase in ${language}.

MISSION COMPLETION:
When the user has successfully achieved the mission objective declared in the scenario:
1. Speak a brief congratulatory message (in character) and say goodbye.
2. THEN call the "complete_mission" tool.
3. Assign a score based on strict criteria: 1 for struggling/English reliance (Tiro), 2 for capable but imperfect (Proficiens), 3 for native-level fluency (Peritus).
4. Provide 3 specific pointers or compliments in the feedback list (in the user's native language: ${fromLanguage}).
`;
          }

          console.log(
            "📝 [App] Setting system instructions for",
            language,
            "Mode:",
            mode
          );
          if (this._mission.open_conversation) {
            systemInstruction = `ROLEPLAY INSTRUCTION: You are a patient German tutor for an ongoing open conversation. Lead with short German questions, wait for answers, and explain important corrections briefly in English.
INTERACTION GUIDELINES: No fixed mission objective. Keep speaking practice relaxed and adapt to the saved chosen level.
MISSION COMPLETION: Only wrap up and call complete_mission when the learner asks to finish, or the app sends a finish request. Use score 0 and specific coaching feedback.`;
          }
          this.client.setSystemInstructions(systemInstruction);

          // Configure Transcription based on Mode
          if (mode === "immergo_teacher") {
            this.client.setInputAudioTranscription(true);
            this.client.setOutputAudioTranscription(true);
          } else {
            this.client.setInputAudioTranscription(false);
            this.client.setOutputAudioTranscription(false);
          }

          // 1. Connect to WebSocket
          console.log("🔌 [App] Connecting to backend...");

          // Execute Recaptcha
          let token = "";
          try {
            token = await this.getRecaptchaToken();
            console.log("Captcha solved:", token);
          } catch (err) {
            console.error("Recaptcha failed:", err);
            // Start without token? Or fail? The server will reject it.
            // Let's proceed and let server reject if needed, or stop.
            // For now, let's stop to be safe.
            isSpeaking = false;
            micBtn.classList.remove('active');
            micBtn.innerHTML = `
                <span style="font-size: 1.3rem; font-weight: 800; margin-bottom: 2px; letter-spacing: 0.02em;">Start Mission</span>
                <span style="font-size: 0.85rem; opacity: 0.9; font-style: italic;">You start the conversation!</span>
            `;
            userViz.disconnect();
            modelViz.disconnect();
            statusEl.textContent = "";
            return;
          }

          await this.client.connect(token);

          // 2. Start Audio Stream
          console.log("🎤 [App] Starting audio stream...");
          await this.audioStreamer.start();

          // Connect User Visualizer
          if (this.audioStreamer.audioContext && this.audioStreamer.source) {
            userViz.connect(
              this.audioStreamer.audioContext,
              this.audioStreamer.source
            );
          }

          // 3. Initialize Audio Player
          console.log("🔊 [App] Initializing audio player...");
          await this.audioPlayer.init();

          // Connect Model Visualizer
          if (this.audioPlayer.audioContext && this.audioPlayer.gainNode) {
            modelViz.connect(
              this.audioPlayer.audioContext,
              this.audioPlayer.gainNode
            );
          }

          console.log("✨ [App] Session active!");
          statusEl.textContent = "Connected and ready to speak";
          statusEl.style.color = "#4CAF50"; // Success green

          // Play start sound
          const startSound = new Audio("/start-bell.mp3");
          startSound.volume = 0.6;
          startSound
            .play()
            .catch((e) => console.error("Failed to play start sound:", e));
        } catch (err) {
          console.error("❌ [App] Failed to start session:", err);
          console.log("Error status:", err.status); // Debug status

          isSpeaking = false;
          micBtn.classList.remove('active');
          // Reset button content to "Start Mission"
          micBtn.innerHTML = `
              <span style="font-size: 1.3rem; font-weight: 800; margin-bottom: 2px; letter-spacing: 0.02em;">Start Mission</span>
              <span style="font-size: 0.85rem; opacity: 0.9; font-style: italic;">You start the conversation!</span>
          `;

          userViz.disconnect();
          modelViz.disconnect();
          statusEl.textContent = "";

          if (err.status === 429) {
            rateLimitDialog.classList.remove("hidden");
            rateLimitDialog.style.display = "flex";
          } else {
            alert("Failed to start session: " + err.message);
          }
        }
      }
    });
  }

  async getRecaptchaToken() {
    return new Promise((resolve) => {
      // Graceful fallback for Simple Mode
      if (typeof grecaptcha === "undefined") {
        console.warn("⚠️ ReCAPTCHA not loaded (Simple Mode). Proceeding without token.");
        resolve(null);
        return;
      }

      try {
        grecaptcha.enterprise.ready(async () => {
          try {
            const t = await grecaptcha.enterprise.execute(
              "6LeSYx8sAAAAAGdRAp8VQ2K9I-KYGWBykzayvQ8n",
              { action: "LOGIN" }
            );
            resolve(t);
          } catch (e) {
            console.warn("⚠️ ReCAPTCHA execution failed (Simple Mode fallback):", e);
            resolve(null);
          }
        });
      } catch (e) {
        console.warn("⚠️ ReCAPTCHA ready failed:", e);
        resolve(null);
      }
    });
  }
}

customElements.define("view-chat", ViewChat);
