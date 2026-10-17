/** Private German practice dashboard. Learning records stay on the owner's VPS. */
class ViewTutor extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="container" style="max-width:820px;padding-bottom:48px">
        <h1 style="margin-top:40px">Your German practice</h1>
        <p>Speak, make mistakes, and build confidence. One question at a time.</p>
        <form class="card" id="preferences" style="display:grid;gap:18px;text-align:left">
          <label>Starting level
            <select id="level" style="display:block;width:100%;padding:12px;margin-top:8px;font:inherit">
              ${['A1','A2','B1','B2','C1','C2'].map(level => `<option ${level === 'A2' ? 'selected' : ''}>${level}</option>`).join('')}
            </select>
          </label>
          <label>What would you like to talk about? (optional)
            <input id="topic" maxlength="300" placeholder="Everyday life, hobbies, travel…" style="display:block;width:100%;padding:12px;margin-top:8px;font:inherit">
          </label>
          <p style="font-size:.95rem">German conversation · brief explanations in English · up to 10 minutes.<br>
          Difficulty adapts within your chosen level. You decide when to change levels.</p>
          <button class="btn-primary" id="start" disabled>Start speaking</button>
          <p id="status" role="status" aria-live="polite">Loading your learning history…</p>
        </form>
        <section class="card" style="text-align:left;margin-top:24px">
          <h2>Your learning history</h2>
          <p>Short AI coaching notes are saved on your private VPS and shared with Gemini to guide your next session. They can be wrong. Audio and full transcripts are not saved by this app.</p>
          <p>Say “finish the session” or use End Mission to request feedback. Closing the page can lose practice since the last checkpoint.</p>
          <div id="history"></div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:20px">
            <button type="button" id="export" disabled>Download history</button>
            <button type="button" id="clear" disabled>Clear learning history</button>
          </div>
        </section>
      </div>`;
    this.querySelector('#preferences').onsubmit = event => this.start(event);
    this.querySelector('#export').onclick = () => this.exportHistory();
    this.querySelector('#clear').onclick = async () => {
      if (!confirm('Delete all saved learning feedback? Your chosen level and topic will stay.')) return;
      try {
        await this.request('/api/profile/reset', {});
        await this.load();
      } catch (error) { this.message(error.message); }
    };
    this.load();
  }

  message(text) { this.querySelector('#status').textContent = text; }

  async request(path, body) {
    const response = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(typeof problem.detail === 'string' ? problem.detail : 'Could not load or save learning history. Please try again.');
    }
    return response.json();
  }

  async load() {
    try {
      this.profile = await this.request('/api/profile');
      if (!this.isConnected) return;
      this.querySelector('#level').value = this.profile.level;
      this.querySelector('#topic').value = this.profile.topic;
      const history = this.querySelector('#history');
      history.replaceChildren();
      if (!this.profile.sessions.length) {
        history.textContent = 'No saved practice yet. Your first conversation starts fresh.';
      }
      for (const record of this.profile.sessions.slice(0, 10)) {
        const article = document.createElement('article');
        article.style.cssText = 'border-top:1px solid #8884;padding:16px 0';
        const heading = document.createElement('h3');
        heading.textContent = `${new Date(record.date).toLocaleString()} · chosen level ${record.level}`;
        article.append(heading);
        const list = document.createElement('ul');
        for (const item of record.feedback) {
          const line = document.createElement('li');
          line.textContent = item;
          list.append(line);
        }
        article.append(list);
        if (record.next_focus) {
          const next = document.createElement('p');
          next.textContent = `Next practice: ${record.next_focus}`;
          article.append(next);
        }
        history.append(article);
      }
      for (const id of ['start', 'export', 'clear']) this.querySelector(`#${id}`).disabled = false;
      this.message('Ready. Your level and topic will be saved when you start.');
    } catch (error) { this.message(error.message); }
  }

  async start(event) {
    event.preventDefault();
    const button = this.querySelector('#start');
    button.disabled = true;
    try {
      await this.request('/api/profile', {
        level: this.querySelector('#level').value,
        topic: this.querySelector('#topic').value.trim() || 'Everyday conversation'
      });
      this.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: {
        view: 'chat', language: 'German', fromLanguage: 'English', mode: 'immergo_teacher',
        mission: { id: 'open', title: 'Open conversation', desc: 'Relaxed German speaking practice. Say hello to begin.', target_role: 'patient German tutor', open_conversation: true }
      }}));
    } catch (error) { button.disabled = false; this.message(error.message); }
  }

  exportHistory() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.profile, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'german-learning-history.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
customElements.define('view-tutor', ViewTutor);


class ViewTutorSummary extends HTMLElement {
  set result(value) { this._result = value; }
  connectedCallback() {
    this.innerHTML = `<div class="container" style="max-width:820px"><h1>Practice finished</h1><section class="card" id="feedback" style="text-align:left"></section><button class="btn-primary" id="home">Back to your practice</button></div>`;
    const box = this.querySelector('#feedback');
    if (this._result?.incomplete) {
      box.textContent = 'No final feedback was received. Earlier saved checkpoints, if any, are available on your practice page.';
    } else {
      const intro = document.createElement('p');
      intro.textContent = 'Feedback saved on your VPS. These are AI coaching suggestions, not a certified assessment.';
      box.append(intro);
      const list = document.createElement('ul');
      for (const note of this._result?.notes || []) {
        const item = document.createElement('li');
        item.textContent = note;
        list.append(item);
      }
      box.append(list);
    }
    this.querySelector('#home').onclick = () => this.dispatchEvent(new CustomEvent('navigate', {bubbles: true, detail: {view: 'tutor'}}));
  }
}
customElements.define('view-tutor-summary', ViewTutorSummary);
