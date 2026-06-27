/* ============================================================
   Lin's NightRead — Complete Application Logic
   ============================================================ */

// ==================== STORAGE MANAGER ====================
class StorageManager {
  constructor() {
    this.dbName = 'nightread-db';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('novels')) {
          const novelsStore = db.createObjectStore('novels', { keyPath: 'id' });
          novelsStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('bibles')) {
          db.createObjectStore('bibles', { keyPath: 'novelId' });
        }
        if (!db.objectStoreNames.contains('outlines')) {
          db.createObjectStore('outlines', { keyPath: 'novelId' });
        }
        if (!db.objectStoreNames.contains('chapters')) {
          const chaptersStore = db.createObjectStore('chapters', { keyPath: 'id' });
          chaptersStore.createIndex('novelId', 'novelId', { unique: false });
          chaptersStore.createIndex('novelId_chapter', ['novelId', 'chapterNumber'], { unique: true });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => {
        console.error('IndexedDB init failed:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  _store(name, mode = 'readonly') {
    const tx = this.db.transaction(name, mode);
    return tx.objectStore(name);
  }

  async _promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // --- Novels ---
  async getAllNovels() {
    const store = this._store('novels');
    return this._promisify(store.getAll());
  }

  async getNovel(id) {
    const store = this._store('novels');
    return this._promisify(store.get(id));
  }

  async saveNovel(novel) {
    const store = this._store('novels', 'readwrite');
    return this._promisify(store.put(novel));
  }

  async deleteNovel(id) {
    const tx = this.db.transaction(['novels', 'bibles', 'outlines', 'chapters'], 'readwrite');
    tx.objectStore('novels').delete(id);
    tx.objectStore('bibles').delete(id);
    tx.objectStore('outlines').delete(id);
    // Delete all chapters for this novel
    const chaptersStore = tx.objectStore('chapters');
    const index = chaptersStore.index('novelId');
    const cursorReq = index.openCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        chaptersStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Bibles ---
  async getBible(novelId) {
    const store = this._store('bibles');
    return this._promisify(store.get(novelId));
  }

  async saveBible(bible) {
    const store = this._store('bibles', 'readwrite');
    return this._promisify(store.put(bible));
  }

  // --- Outlines ---
  async getOutline(novelId) {
    const store = this._store('outlines');
    return this._promisify(store.get(novelId));
  }

  async saveOutline(outline) {
    const store = this._store('outlines', 'readwrite');
    return this._promisify(store.put(outline));
  }

  // --- Chapters ---
  async getChapters(novelId) {
    const store = this._store('chapters');
    const index = store.index('novelId');
    const chapters = await this._promisify(index.getAll(novelId));
    return chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
  }

  async getChapter(novelId, chapterNumber) {
    const store = this._store('chapters');
    const index = store.index('novelId_chapter');
    return this._promisify(index.get([novelId, chapterNumber]));
  }

  async saveChapter(chapter) {
    const store = this._store('chapters', 'readwrite');
    return this._promisify(store.put(chapter));
  }

  async exportAll() {
    const novels = await this.getAllNovels();
    const data = { novels, bibles: [], outlines: [], chapters: [] };
    for (const novel of novels) {
      const bible = await this.getBible(novel.id);
      if (bible) data.bibles.push(bible);
      const outline = await this.getOutline(novel.id);
      if (outline) data.outlines.push(outline);
      const chapters = await this.getChapters(novel.id);
      data.chapters.push(...chapters);
    }
    return data;
  }

  async importAll(data) {
    if (data.novels) {
      for (const novel of data.novels) await this.saveNovel(novel);
    }
    if (data.bibles) {
      for (const bible of data.bibles) await this.saveBible(bible);
    }
    if (data.outlines) {
      for (const outline of data.outlines) await this.saveOutline(outline);
    }
    if (data.chapters) {
      for (const chapter of data.chapters) await this.saveChapter(chapter);
    }
  }

  async clearAll() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);
      request.onsuccess = () => {
        this.db = null;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// ==================== API MANAGER ====================
class APIManager {
  constructor() {
    this.settings = this._loadSettings();
  }

  _loadSettings() {
    try {
      const s = localStorage.getItem('nightread_settings');
      if (s) return JSON.parse(s);
    } catch (e) { /* ignore */ }
    return {
      apiKey: '',
      apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      apiModel: 'deepseek-chat'
    };
  }

  saveSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    localStorage.setItem('nightread_settings', JSON.stringify(this.settings));
  }

  getSettings() {
    return { ...this.settings };
  }

  isConfigured() {
    return !!(this.settings.apiKey && this.settings.apiUrl);
  }

  async testConnection() {
    try {
      const response = await fetch(this.settings.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify({
          model: this.settings.apiModel,
          messages: [{ role: 'user', content: 'Hello, respond with just "ok".' }],
          max_tokens: 5,
          stream: false
        })
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      }
      return true;
    } catch (e) {
      throw new Error(`连接失败: ${e.message}`);
    }
  }

  /**
   * Stream a chat completion. Yields tokens as they arrive.
   * @param {Array} messages - Array of {role, content}
   * @param {Object} options - {temperature, maxTokens, onToken, onDone, onError}
   * @returns {Promise<string>} Full accumulated text
   */
  async streamChat(messages, options = {}) {
    const {
      temperature = 0.8,
      maxTokens = 4096,
      onToken = null,
      onDone = null,
      onError = null
    } = options;

    const url = this.settings.apiUrl;
    const body = {
      model: this.settings.apiModel,
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens,
      stream: true
    };

    let fullText = '';
    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.settings.apiKey}`
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errText = await response.text();
          let errMsg = `API 错误 (${response.status})`;
          if (response.status === 401) errMsg = 'API Key 无效，请检查设置';
          else if (response.status === 429) errMsg = '请求过于频繁，请稍后再试';
          else if (response.status === 404) errMsg = 'API 地址不存在，请检查 Endpoint URL';
          else {
            try {
              const errJson = JSON.parse(errText);
              errMsg = errJson.error?.message || errMsg;
            } catch (e) { errMsg += `: ${errText.slice(0, 100)}`; }
          }
          throw new Error(errMsg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;

            let dataStr = trimmed;
            if (trimmed.startsWith('data: ')) {
              dataStr = trimmed.slice(6);
            }

            // Handle non-standard prefixes
            if (dataStr.startsWith('data:')) {
              dataStr = dataStr.slice(5).trim();
            }

            try {
              const json = JSON.parse(dataStr);
              const choices = json.choices || [];
              for (const choice of choices) {
                const delta = choice.delta || {};
                const content = delta.content || '';
                if (content) {
                  fullText += content;
                  if (onToken) onToken(content, fullText);
                }
              }
            } catch (e) {
              // Skip unparseable lines
            }
          }
        }

        // Process remaining buffer
        if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
          let ds = buffer.trim();
          if (ds.startsWith('data: ')) ds = ds.slice(6);
          try {
            const json = JSON.parse(ds);
            const choices = json.choices || [];
            for (const choice of choices) {
              const delta = choice.delta || {};
              const content = delta.content || '';
              if (content) {
                fullText += content;
                if (onToken) onToken(content, fullText);
              }
            }
          } catch (e) { /* ignore */ }
        }

        if (onDone) onDone(fullText);
        return fullText;

      } catch (e) {
        if (retries < maxRetries && e.message.includes('fetch')) {
          retries++;
          await new Promise(r => setTimeout(r, 1000 * retries));
          continue;
        }
        if (onError) onError(e);
        throw e;
      }
    }
  }
}

// ==================== NOVEL ENGINE ====================
class NovelEngine {
  constructor(apiManager) {
    this.api = apiManager;
  }

  /**
   * Generate World Bible
   */
  async generateBible(prefs, onToken = null) {
    const systemPrompt = `你是一个专业的小说世界观设定师。你的任务是根据用户偏好，为一部小说构建完整、细腻、有深度的世界观设定。

请严格按照以下 JSON 格式输出（不要输出其他内容）：

{
  "worldSetting": "世界背景的详细描述，包括时代、地理、社会结构、科技/魔法水平等",
  "worldRules": ["规则1", "规则2", "规则3", ...],
  "factions": [
    {
      "name": "势力名称",
      "description": "势力描述",
      "goals": "势力目标",
      "relationships": "与其他势力的关系"
    }
  ],
  "characters": [
    {
      "name": "角色名",
      "role": "主角/配角/反派",
      "personality": "性格特征",
      "appearance": "外貌描述",
      "background": "背景故事",
      "abilities": "能力/技能",
      "conflicts": "内心冲突与外在冲突",
      "relationships": "与其他角色的关系"
    }
  ],
  "atmosphere": "整体氛围描述"
}

要求：
- 角色至少包含 1 个主角和 2-4 个重要配角
- 世界观要有独特的亮点，避免平庸
- 角色之间要有复杂的关系网
- 中文输出，描写生动`;

    const userPrompt = `请根据以下偏好生成世界观设定：

题材：${prefs.genre || '不限'}
故事元素：${prefs.tropes?.join('、') || '不限'}
文风：${prefs.style || '不限'}
主角偏好：${prefs.protagonist || '不限'}
额外要求：${prefs.extra || '无'}
小说标题：${prefs.title || '未命名'}

请直接输出 JSON，不要用 markdown 代码块包裹。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    let rawText = '';
    const result = await this.api.streamChat(messages, {
      temperature: 0.9,
      maxTokens: 8192,
      onToken: (token, full) => {
        rawText = full;
        if (onToken) onToken(token, full);
      }
    });

    return this._parseBibleJSON(rawText);
  }

  _parseBibleJSON(text) {
    // Clean up markdown code blocks if present
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    try {
      const bible = JSON.parse(jsonStr);
      return bible;
    } catch (e) {
      // Try to extract JSON object
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {
          throw new Error(`无法解析世界观 JSON: ${e.message}`);
        }
      }
      throw new Error(`世界观生成格式错误，请重试`);
    }
  }

  /**
   * Generate Outline
   */
  async generateOutline(bible, prefs, onToken = null) {
    const bibleSummary = this._summarizeBible(bible);

    const systemPrompt = `你是一个专业的小说大纲设计师。根据已有的世界观设定，生成一个包含 12-18 个节点的分支故事大纲。

请严格按照以下 JSON 格式输出：

{
  "nodes": [
    {
      "id": "node_1",
      "title": "节点标题",
      "summary": "本章节的故事概要（50-100字）",
      "choices": [
        {"id": "choice_a", "text": "选项A：具体描述", "nextNodeId": "node_2"},
        {"id": "choice_b", "text": "选项B：具体描述", "nextNodeId": "node_3"}
      ],
      "isEnding": false
    }
  ]
}

要求：
- 节点数量 12-18 个
- 故事要有起伏，遵循三幕结构
- 关键节点要有分支选择（至少每 2-3 个节点有一个选择点）
- 最后一个节点的 isEnding 为 true
- 分支要合理汇合，形成网状结构
- 中文输出`;

    const userPrompt = `世界观概要：
${bibleSummary}

小说标题：${prefs.title || '未命名'}
题材：${prefs.genre || '不限'}
文风：${prefs.style || '不限'}

请生成故事大纲，直接输出 JSON。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    let rawText = '';
    await this.api.streamChat(messages, {
      temperature: 0.9,
      maxTokens: 8192,
      onToken: (token, full) => {
        rawText = full;
        if (onToken) onToken(token, full);
      }
    });

    return this._parseOutlineJSON(rawText);
  }

  _parseOutlineJSON(text) {
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); }
        catch (e2) { throw new Error(`无法解析大纲 JSON: ${e.message}`); }
      }
      throw new Error(`大纲生成格式错误，请重试`);
    }
  }

  _summarizeBible(bible) {
    const parts = [];
    if (bible.worldSetting) parts.push(`世界设定：${bible.worldSetting.slice(0, 300)}`);
    if (bible.characters) {
      const charNames = bible.characters.map(c => `${c.name}(${c.role || '角色'})`).join('、');
      parts.push(`主要角色：${charNames}`);
    }
    if (bible.factions) {
      const factionNames = bible.factions.map(f => f.name).join('、');
      parts.push(`势力：${factionNames}`);
    }
    if (bible.atmosphere) parts.push(`氛围：${bible.atmosphere}`);
    return parts.join('\n');
  }

  _formatBibleContext(bible) {
    let ctx = '【世界观设定】\n';
    if (bible.worldSetting) ctx += `世界背景：${bible.worldSetting}\n`;
    if (bible.worldRules?.length) ctx += `世界规则：\n${bible.worldRules.map(r => `- ${r}`).join('\n')}\n`;
    if (bible.atmosphere) ctx += `整体氛围：${bible.atmosphere}\n`;

    if (bible.characters?.length) {
      ctx += '\n【角色档案】\n';
      for (const c of bible.characters) {
        ctx += `- ${c.name}（${c.role || '角色'}）：${c.personality || ''}。外貌：${c.appearance || ''}。背景：${c.background || ''}。能力：${c.abilities || ''}。冲突：${c.conflicts || ''}\n`;
      }
    }

    if (bible.factions?.length) {
      ctx += '\n【势力】\n';
      for (const f of bible.factions) {
        ctx += `- ${f.name}：${f.description || ''}（目标：${f.goals || ''}）\n`;
      }
    }

    return ctx;
  }

  /**
   * Generate a single chapter
   */
  async generateChapter(bible, outline, novel, chapterNumber, nodeId, choiceText, previousSummary, previousChapterFull, onToken = null) {
    const bibleContext = this._formatBibleContext(bible);
    const node = outline.nodes?.find(n => n.id === nodeId) || {};
    const nodeInfo = `本章大纲节点：${node.title || '待定'}\n本章概要：${node.summary || '根据故事自然发展'}`;

    const systemPrompt = `你是一个专业的小说作家。根据以下完整的设定和大纲，写出精彩的小说章节。

${bibleContext}

【写作要求】
- 题材：${novel.genre || '不限'}
- 文风：${novel.style || '文学性'}
- 每章 1500-3000 字
- 章节结尾要自然地引出选择点
- 描写细腻，对话生动，情节推进有力
- 使用中文写作
- 章节末尾用 "---CHOICES---" 分隔符标注 2-3 个读者选择（如果大纲中有选择点的话）
  每个选择格式：
  [选项A] 具体的选择描述
  [选项B] 具体的选择描述

如果大纲中当前节点没有 choices，则自然结尾，不要标注选择。`;

    const contextParts = [];
    if (previousSummary) {
      contextParts.push(`【前情提要】\n${previousSummary}`);
    }
    if (previousChapterFull) {
      contextParts.push(`【上一章完整内容】\n${previousChapterFull.slice(-2000)}`);
    }
    contextParts.push(`【本章大纲】\n${nodeInfo}`);

    if (choiceText) {
      contextParts.push(`【读者上一章的选择】\n${choiceText}`);
    }

    const userPrompt = `请写出《${novel.title || '未命名'}》的第 ${chapterNumber} 章。

${contextParts.join('\n\n')}

请开始写作。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    let rawText = '';
    await this.api.streamChat(messages, {
      temperature: 0.85,
      maxTokens: 6144,
      onToken: (token, full) => {
        rawText = full;
        if (onToken) onToken(token, full);
      }
    });

    return this._parseChapter(rawText, node);
  }

  _parseChapter(text, outlineNode) {
    if (!text || !text.trim()) {
      return {
        content: '（生成内容为空，请重试）',
        choices: outlineNode?.choices || [{
          id: 'continue',
          text: '继续故事发展',
          nextNodeId: outlineNode?.id
        }]
      };
    }

    // Split content and choices
    const choiceMarker = '---CHOICES---';
    const idx = text.indexOf(choiceMarker);
    let content = text;
    let choices = [];

    if (idx !== -1) {
      content = text.slice(0, idx).trim();
      const choiceSection = text.slice(idx + choiceMarker.length).trim();
      choices = this._parseChoices(choiceSection);
    } else {
      // Try to find choices near the end
      const lines = text.split('\n');
      let choiceStart = -1;
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
        const lt = lines[i].trim();
        if (lt.startsWith('[选项') || lt.startsWith('选项') ||
            /^[A-C][\.\)）]/.test(lt)) {
          choiceStart = i;
          break;
        }
      }
      if (choiceStart > 0 && choiceStart < lines.length) {
        content = lines.slice(0, choiceStart).join('\n').trim();
        choices = this._parseChoices(lines.slice(choiceStart).join('\n'));
      }
    }

    // If outline node has choices but AI didn't generate any, use outline's
    if (choices.length === 0 && outlineNode?.choices?.length) {
      choices = outlineNode.choices.map(c => ({
        id: c.id,
        text: c.text,
        nextNodeId: c.nextNodeId
      }));
    }
    // Otherwise leave choices empty → UI shows simple "下一章" button

    return { content, choices };
  }

  _parseChoices(text) {
    const choices = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try bracket format: [选项A] description
      let bracketMatch = trimmed.match(/^\[选项([A-C])\]\s*(.+)/);
      if (bracketMatch) {
        choices.push({
          id: `choice_${choices.length}`,
          text: bracketMatch[2],
          nextNodeId: null
        });
        continue;
      }

      // Try label format: 选项 A: description
      let labelMatch = trimmed.match(/^选项\s*([A-C])[:：]\s*(.+)/);
      if (labelMatch) {
        choices.push({
          id: `choice_${choices.length}`,
          text: labelMatch[2],
          nextNodeId: null
        });
        continue;
      }

      // Try loose format: A) description or A. description
      let looseMatch = trimmed.match(/^([A-C])[\.\)）]\s*(.+)/);
      if (looseMatch) {
        choices.push({
          id: `choice_${choices.length}`,
          text: looseMatch[2],
          nextNodeId: null
        });
      }
    }

    return choices;
  }

  /**
   * Generate chapter summary
   */
  async generateSummary(chapterContent, onToken = null) {
    const systemPrompt = `你是一个专业的小说编辑。请用 150-250 字总结以下章节的关键情节、人物发展和重要转折。只输出总结文本。`;
    const userPrompt = `请总结以下章节：

${chapterContent.slice(-3000)}

请用中文输出总结（150-250字）：`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    let summary = '';
    await this.api.streamChat(messages, {
      temperature: 0.3,
      maxTokens: 500,
      onToken: (token, full) => {
        summary = full;
        if (onToken) onToken(token, full);
      }
    });

    return summary.trim();
  }

  /**
   * Dynamic outline rewrite after a choice
   */
  async rewriteOutline(bible, currentOutline, choiceNodeId, choiceText, novel, onToken = null) {
    const bibleSummary = this._summarizeBible(bible);
    const remainingNodes = currentOutline.nodes
      .filter(n => n.id !== 'node_1' && !currentOutline.nodes.slice(0, currentOutline.nodes.findIndex(n2 => n2.id === choiceNodeId)).includes(n))
      .map(n => `- ${n.id}: ${n.title} - ${n.summary}`)
      .join('\n');

    const systemPrompt = `你是一个小说大纲设计师。根据读者的选择，重新调整故事大纲的后续节点。
请以 JSON 格式输出调整后的大纲节点（仅输出后续节点部分）：

{
  "nodes": [
    {
      "id": "节点ID",
      "title": "节点标题",
      "summary": "概要",
      "choices": [{"id": "...", "text": "...", "nextNodeId": "..."}],
      "isEnding": false
    }
  ]
}

保持原有节点数量（约 ${currentOutline.nodes.length} 个），直接输出 JSON。`;

    const userPrompt = `世界观：${bibleSummary}
小说：${novel.title}
读者选择：${choiceText}
当前大纲后续节点：${remainingNodes || '（全部重新规划）'}

请调整大纲，直接输出 JSON。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    let rawText = '';
    await this.api.streamChat(messages, {
      temperature: 0.8,
      maxTokens: 4096,
      onToken: (token, full) => {
        rawText = full;
        if (onToken) onToken(token, full);
      }
    });

    const parsed = this._parseOutlineJSON(rawText);
    // Merge: keep nodes up to choiceNodeId, replace remaining
    const choiceIdx = currentOutline.nodes.findIndex(n => n.id === choiceNodeId);
    const newNodes = [
      ...currentOutline.nodes.slice(0, choiceIdx + 1),
      ...(parsed.nodes || [])
    ];
    return { nodes: newNodes };
  }
}

// ==================== UI MANAGER ====================
class UIManager {
  constructor() {
    this.currentView = 'splash';
    this.currentNovelId = null;
    this.sidebarOpen = false;
    this.isGenerating = false;
    this.fontSize = 18;
    this.lineHeight = 2.0;
    this._loadReadingPrefs();
  }

  _loadReadingPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem('nightread_reading_prefs') || '{}');
      this.fontSize = prefs.fontSize || 18;
      this.lineHeight = prefs.lineHeight || 2.0;
    } catch (e) { /* ignore */ }
  }

  _saveReadingPrefs() {
    localStorage.setItem('nightread_reading_prefs', JSON.stringify({
      fontSize: this.fontSize,
      lineHeight: this.lineHeight
    }));
  }

  // --- View Navigation ---
  navigateTo(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const viewEl = document.getElementById(`view-${viewName}`);
    if (viewEl) viewEl.classList.add('active');
    this.currentView = viewName;

    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.view === viewName);
    });
  }

  // --- Toast ---
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 3000);
  }

  // --- Modal ---
  showModal(title, bodyHTML, footerHTML = '') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    document.getElementById('modal-footer').innerHTML = footerHTML;
    document.getElementById('modal-overlay').classList.remove('hidden');
  }

  hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  // --- Library ---
  renderLibrary(novels) {
    const grid = document.getElementById('library-grid');
    const empty = document.getElementById('library-empty');

    if (!novels || novels.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = novels.map(novel => `
      <div class="novel-card" data-novel-id="${novel.id}" onclick="window._app.openNovel('${novel.id}')">
        <button class="novel-card-delete" onclick="event.stopPropagation(); window._app.deleteNovelPrompt('${novel.id}')" title="删除">✕</button>
        <div class="novel-card-title">${this._escape(novel.title || '未命名')}</div>
        <div class="novel-card-meta">
          ${novel.genre ? `<span>${this._escape(novel.genre)}</span>` : ''}
          ${novel.style ? `<span>${this._escape(novel.style)}</span>` : ''}
          ${novel.tropes?.length ? `<span>${this._escape(novel.tropes.slice(0, 2).join('·'))}</span>` : ''}
        </div>
        <div class="novel-card-progress">
          已读至第 ${novel.lastReadChapter || 0} 章 · ${novel.totalChapters || 0} 章
        </div>
      </div>
    `).join('');
  }

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Setup Wizard ---
  resetWizard() {
    document.getElementById('wizard-step-1').classList.add('active');
    document.getElementById('gen-results').classList.add('hidden');
    document.getElementById('gen-status').classList.remove('hidden');
    document.getElementById('bible-editor').innerHTML = '<p class="text-muted">等待生成...</p>';
    document.getElementById('outline-editor').innerHTML = '<p class="text-muted">等待生成...</p>';
    document.getElementById('bible-editor').contentEditable = 'false';
    document.getElementById('outline-editor').contentEditable = 'false';
    this._setWizardStep(1);

    // Reset inputs
    document.getElementById('novel-title-input').value = '';
    document.getElementById('novel-genre').value = '';
    document.getElementById('novel-style').value = '';  // now a text input, datalist is just suggestions
    document.getElementById('novel-protagonist').value = '';
    document.getElementById('novel-extra').value = '';
    document.querySelectorAll('#trope-tags .tag').forEach(t => t.classList.remove('active'));
  }

  _setWizardStep(step) {
    document.querySelectorAll('.wizard-step').forEach(s => {
      const sNum = parseInt(s.dataset.step);
      s.classList.remove('active', 'done');
      if (sNum < step) s.classList.add('done');
      if (sNum === step) s.classList.add('active');
    });
    document.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`wizard-step-${step}`)?.classList.add('active');
  }

  showGenStatus(message) {
    document.getElementById('gen-status-text').textContent = message;
    document.getElementById('gen-status').classList.remove('hidden');
    document.getElementById('gen-results').classList.add('hidden');
  }

  showGenResults(bibleText, outlineText, editable = true) {
    document.getElementById('gen-status').classList.add('hidden');
    document.getElementById('gen-results').classList.remove('hidden');
    document.getElementById('bible-editor').innerHTML = bibleText || '<p class="text-muted">无内容</p>';
    document.getElementById('outline-editor').innerHTML = outlineText || '<p class="text-muted">无内容</p>';
    document.getElementById('bible-editor').contentEditable = editable ? 'true' : 'false';
    document.getElementById('outline-editor').contentEditable = editable ? 'true' : 'false';
    this._setWizardStep(2);
  }

  getWizardPrefs() {
    const tags = [];
    document.querySelectorAll('#trope-tags .tag.active').forEach(t => tags.push(t.dataset.tag));
    return {
      title: document.getElementById('novel-title-input').value.trim(),
      genre: document.getElementById('novel-genre').value,
      tropes: tags,
      style: document.getElementById('novel-style').value,
      protagonist: document.getElementById('novel-protagonist').value.trim(),
      extra: document.getElementById('novel-extra').value.trim()
    };
  }

  getEditedBible() {
    return document.getElementById('bible-editor').innerText;
  }

  getEditedOutline() {
    return document.getElementById('outline-editor').innerText;
  }

  // --- Reader ---
  showReader(novel, chapter) {
    document.getElementById('reader-novel-title').textContent = novel.title || '未命名';
    document.getElementById('reader-chapter-num').textContent = `第 ${chapter?.chapterNumber || 1} 章`;
    document.getElementById('chapter-title').textContent = chapter?.title || '';

    const body = document.getElementById('chapter-body');
    if (chapter?.content) {
      body.innerHTML = this._formatChapterContent(chapter.content);
    } else {
      body.innerHTML = '<p class="text-muted">准备生成章节...</p>';
    }

    // 清空选择区，等展示时再填
    document.getElementById('reader-choices').innerHTML = '';
    document.getElementById('nav-reader-tab').style.display = '';
    document.getElementById('reader-main').scrollTop = 0;

    // 桌面端默认显示侧栏，移动端默认隐藏（通过 toggle 展开）
    this.sidebarOpen = window.innerWidth > 900;
    this._updateSidebarVisibility();
    // 确保桌面端侧栏不被其他样式或之前的 display:none 盖住
    if (window.innerWidth > 900) {
      document.getElementById('reader-sidebar').style.removeProperty('display');
    }
  }

  _formatChapterContent(content) {
    // Simple markdown-like formatting
    const paragraphs = content.split('\n').filter(p => p.trim());
    return paragraphs.map(p => {
      const trimmed = p.trim();
      if (trimmed.startsWith('# ')) return `<h3 class="chapter-subtitle">${this._escape(trimmed.slice(2))}</h3>`;
      if (trimmed.startsWith('## ')) return `<h3 class="chapter-subtitle">${this._escape(trimmed.slice(3))}</h3>`;
      return `<p>${this._escape(trimmed)}</p>`;
    }).join('\n');
  }

  appendChapterToken(token) {
    const body = document.getElementById('chapter-body');
    if (body.querySelector('.text-muted') && body.textContent.trim() === '准备生成章节...') {
      body.innerHTML = '';
    }

    // Append to last paragraph or create new
    const lastP = body.querySelector('p:last-of-type');
    if (lastP && !lastP.textContent.endsWith('\n\n')) {
      lastP.textContent += token;
    } else {
      const p = document.createElement('p');
      p.textContent = token;
      body.appendChild(p);
    }

    // Auto-scroll
    const main = document.getElementById('reader-main');
    main.scrollTop = main.scrollHeight;
  }

  showTypingIndicator(show) {
    const indicator = document.getElementById('typing-indicator');
    indicator.classList.toggle('hidden', !show);
    if (show) {
      const main = document.getElementById('reader-main');
      main.scrollTop = main.scrollHeight;
    }
  }

  showChoices(choices, chapterNum, outlineNode) {
    const container = document.getElementById('reader-choices');

    // 只有大纲节点确实有选择点时，才展示 AVG 式分支选择
    const hasRealChoices = choices && choices.length > 0 &&
      outlineNode?.choices?.length > 0 &&
      !outlineNode?.isEnding;

    // 没有选择点 → 安安静静一个"下一章"按钮
    if (!hasRealChoices) {
      const isEnding = outlineNode?.isEnding;
      container.innerHTML = isEnding ? `
        <div class="choices-ending">
          <p class="text-muted" style="text-align:center;margin-bottom:12px">—— 本卷终 ——</p>
        </div>
      ` : `
        <button class="next-chapter-btn" data-action="next-chapter">
          <span class="choice-label">→</span> 阅读下一章
        </button>
      `;
      return;
    }

    const choiceHTML = choices.map((c, i) => `
      <button class="choice-btn" data-choice-id="${c.id}">
        <span class="choice-label">${String.fromCharCode(9312 + i)}</span> ${this._escape(c.text)}
      </button>
    `).join('');

    container.innerHTML = `
      <h4>📌 接下来的走向是：</h4>
      ${choiceHTML}
      <div class="choice-custom">
        <input type="text" id="custom-choice-input" placeholder="或输入你想看到的发展...">
        <button id="btn-custom-choice">✏️ 自定义</button>
      </div>
    `;
  }

  updateOutlineProgress(outline, currentChapterNum, chapters = []) {
    const container = document.getElementById('outline-progress');
    if (!outline?.nodes?.length) {
      container.innerHTML = '<p class="text-muted" style="font-size:0.8rem">暂无大纲数据</p>';
      return;
    }

    // 只显示有对应章节的节点（已生成缓存的）
    const generatedChapters = chapters?.filter(c => c?.content) || [];
    const generatedNums = new Set(generatedChapters.map(c => c.chapterNumber));

    container.innerHTML = outline.nodes.map((node, i) => {
      const chNum = i + 1;
      const exists = generatedNums.has(chNum);
      if (!exists) return ''; // 未生成的不渲染

      let cls = 'clickable';
      if (chNum < currentChapterNum) cls += ' done';
      else if (chNum === currentChapterNum) cls += ' current';

      // 第一个节点默认作为"序章"显示章节号
      const label = node.title || `第 ${chNum} 章`;
      return `
        <div class="outline-node ${cls}" data-chapter="${chNum}">
          <div class="node-dot"></div>
          <div class="node-title">${label}</div>
        </div>
      `;
    }).filter(Boolean).join('');

    // 如果一个已生成节点都没有
    if (container.innerHTML.trim() === '') {
      container.innerHTML = '<p class="text-muted" style="font-size:0.8rem">暂无已生成的章节</p>';
    }
  }

  updateCharacterList(bible) {
    const container = document.getElementById('character-list');
    if (!bible?.characters?.length) {
      container.innerHTML = '<p class="text-muted" style="font-size:0.8rem">暂无角色数据</p>';
      return;
    }

    container.innerHTML = bible.characters.map(c => `
      <div class="character-card">
        <div class="character-name">${this._escape(c.name)} ${c.role ? `(${this._escape(c.role)})` : ''}</div>
        <div class="character-detail">
          ${c.personality ? `性格：${this._escape(c.personality)}` : ''}
          ${c.abilities ? `<br>能力：${this._escape(c.abilities)}` : ''}
          ${c.conflicts ? `<br>冲突：${this._escape(c.conflicts)}` : ''}
        </div>
      </div>
    `).join('');
  }

  updateWorldRules(bible) {
    const container = document.getElementById('world-rules-quick');
    if (!bible) {
      container.innerHTML = '<p class="text-muted" style="font-size:0.8rem">暂无世界观数据</p>';
      return;
    }

    let html = '';
    if (bible.worldSetting) {
      html += `<p style="margin-bottom:6px">${this._escape(bible.worldSetting.slice(0, 150))}...</p>`;
    }
    if (bible.worldRules?.length) {
      html += '<ul style="padding-left:16px;margin:0">';
      bible.worldRules.slice(0, 4).forEach(r => {
        html += `<li>${this._escape(r.slice(0, 60))}${r.length > 60 ? '...' : ''}</li>`;
      });
      html += '</ul>';
    }
    if (bible.atmosphere) {
      html += `<p style="margin-top:6px;font-style:italic">氛围：${this._escape(bible.atmosphere)}</p>`;
    }
    container.innerHTML = html || '<p class="text-muted" style="font-size:0.8rem">暂无世界观数据</p>';
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    this._updateSidebarVisibility();
  }

  _updateSidebarVisibility() {
    const sidebar = document.getElementById('reader-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (window.innerWidth <= 900) {
      sidebar.classList.toggle('open', this.sidebarOpen);
      overlay.classList.toggle('hidden', !this.sidebarOpen);
    } else {
      sidebar.style.display = this.sidebarOpen ? '' : 'none';
    }
  }

  applyReadingPrefs() {
    const body = document.getElementById('chapter-body');
    body.style.fontSize = `${this.fontSize}px`;
    body.style.lineHeight = this.lineHeight;
  }
}

// ==================== MAIN APPLICATION ====================
class App {
  constructor() {
    this.storage = new StorageManager();
    this.api = new APIManager();
    this.engine = new NovelEngine(this.api);
    this.ui = new UIManager();

    // Current novel context
    this.currentNovel = null;
    this.currentBible = null;
    this.currentOutline = null;
    this.currentChapters = [];
    this.currentChapterNum = 1;

    // Generation state
    this.isGenerating = false;
  }

  async init() {
    try {
      await this.storage.init();
    } catch (e) {
      console.error('Storage init failed:', e);
      this.ui.toast('浏览器存储初始化失败，请检查是否允许了 IndexedDB', 'error');
    }

    this._bindEvents();
    this._loadSettings();

    // Register service worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js');
        console.log('[SW] Registered');
      } catch (e) {
        console.warn('[SW] Registration failed:', e);
      }
    }

    // Check first launch
    const hasVisited = localStorage.getItem('nightread_visited');
    if (!hasVisited) {
      // Stay on splash
      localStorage.setItem('nightread_visited', '1');
    } else {
      // Auto-skip splash if API is configured
      if (this.api.isConfigured()) {
        this._showApp();
        this._navigateToLibrary();
      }
    }

    this._handleResize();
  }

  _bindEvents() {
    // Splash
    document.getElementById('btn-splash-start').addEventListener('click', () => this._onSplashStart());

    // Nav tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        if (view === 'library') this._navigateToLibrary();
        else if (view === 'reader' && this.currentNovel) this._navigateToReader();
        else if (view === 'settings') this._navigateToSettings();
      });
    });

    // Library
    document.getElementById('btn-new-novel').addEventListener('click', () => this._startNewNovel());

    // Wizard
    document.getElementById('btn-wizard-next-1').addEventListener('click', () => this._onWizardGenerate());
    document.getElementById('btn-wizard-cancel').addEventListener('click', () => this._navigateToLibrary());
    document.getElementById('btn-regenerate').addEventListener('click', () => this._onWizardRegenerate());
    document.getElementById('btn-wizard-start-read').addEventListener('click', () => this._onWizardStartRead());

    // Gen tabs
    document.querySelectorAll('.gen-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.gen-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.gen-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`gen-panel-${tab.dataset.genTab}`)?.classList.add('active');
      });
    });

    // Reader
    document.getElementById('btn-reader-back').addEventListener('click', () => this._navigateToLibrary());
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => this.ui.toggleSidebar());
    document.getElementById('reader-choices').addEventListener('click', (e) => this._onChoicesClick(e));
    document.getElementById('sidebar-overlay').addEventListener('click', () => this.ui.toggleSidebar());
    document.getElementById('btn-download-book').addEventListener('click', () => this._onDownloadBook());
    document.getElementById('outline-progress').addEventListener('click', (e) => this._onOutlineNodeClick(e));

    // Settings
    document.getElementById('btn-toggle-api-key').addEventListener('click', () => {
      const input = document.getElementById('settings-api-key');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('settings-api-preset').addEventListener('change', (e) => this._onPresetChange(e));
    document.getElementById('btn-fetch-models').addEventListener('click', () => this._onFetchModels());
    document.getElementById('btn-test-api').addEventListener('click', () => this._onTestAPI());
    document.getElementById('btn-settings-save').addEventListener('click', () => this._onSaveSettings());
    document.getElementById('btn-export-all').addEventListener('click', () => this._onExportAll());
    document.getElementById('btn-import-all').addEventListener('click', () => document.getElementById('import-file-input').click());
    document.getElementById('import-file-input').addEventListener('change', (e) => this._onImportAll(e));
    document.getElementById('btn-clear-all').addEventListener('click', () => this._onClearAll());
    document.getElementById('settings-font-size').addEventListener('input', (e) => {
      this.ui.fontSize = parseInt(e.target.value);
      document.getElementById('font-size-value').textContent = `${this.ui.fontSize}px`;
      this.ui.applyReadingPrefs();
    });
    document.getElementById('settings-line-height').addEventListener('input', (e) => {
      this.ui.lineHeight = parseFloat(e.target.value);
      document.getElementById('line-height-value').textContent = this.ui.lineHeight.toFixed(1);
      this.ui.applyReadingPrefs();
    });

    // Modal
    document.getElementById('modal-close').addEventListener('click', () => this.ui.hideModal());
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.ui.hideModal();
    });

    // Tag selection
    document.querySelectorAll('#trope-tags .tag').forEach(tag => {
      tag.addEventListener('click', () => tag.classList.toggle('active'));
    });

    // Window resize
    window.addEventListener('resize', () => this._handleResize());

    // Expose for inline handlers
    window._app = this;
  }

  // --- Navigation ---

  _showApp() {
    document.getElementById('view-splash').classList.remove('active');
    document.getElementById('app-shell').classList.remove('hidden');
  }

  async _navigateToLibrary() {
    this._showApp();
    this.ui.navigateTo('library');
    this.currentNovel = null;
    document.getElementById('nav-reader-tab').style.display = 'none';
    await this._refreshLibrary();
  }

  async _refreshLibrary() {
    const novels = await this.storage.getAllNovels();
    this.ui.renderLibrary(novels);
  }

  _navigateToReader() {
    this.ui.navigateTo('reader');
    document.getElementById('nav-reader-tab').style.display = '';
  }

  _navigateToSettings() {
    this._showApp();
    this.ui.navigateTo('settings');
    this._loadSettings();
  }

  // --- Splash ---
  _onSplashStart() {
    this._showApp();
    if (!this.api.isConfigured()) {
      this._navigateToSettings();
      setTimeout(() => {
        this.ui.toast('请先配置 API Key 才能使用 AI 生成功能', 'warning');
      }, 500);
    } else {
      this._navigateToLibrary();
    }
  }

  // --- Settings ---
  _loadSettings() {
    const settings = this.api.getSettings();
    document.getElementById('settings-api-key').value = settings.apiKey || '';
    document.getElementById('settings-api-url').value = settings.apiUrl || '';
    document.getElementById('settings-api-model').value = settings.apiModel || '';
    document.getElementById('settings-font-size').value = this.ui.fontSize;
    document.getElementById('font-size-value').textContent = `${this.ui.fontSize}px`;
    document.getElementById('settings-line-height').value = this.ui.lineHeight;
    document.getElementById('line-height-value').textContent = this.ui.lineHeight.toFixed(1);
  }

  async _onSaveSettings() {
    const settings = {
      apiKey: document.getElementById('settings-api-key').value.trim(),
      apiUrl: document.getElementById('settings-api-url').value.trim(),
      apiModel: document.getElementById('settings-api-model').value.trim()
    };

    if (!settings.apiUrl) {
      this.ui.toast('请输入 API Endpoint URL', 'warning');
      return;
    }

    this.api.saveSettings(settings);

    // Save reading prefs
    this.ui.fontSize = parseInt(document.getElementById('settings-font-size').value);
    this.ui.lineHeight = parseFloat(document.getElementById('settings-line-height').value);
    this.ui._saveReadingPrefs();
    this.ui.applyReadingPrefs();

    this.ui.toast('设置已保存 ✓', 'success');
  }

  _onPresetChange(e) {
    const preset = e.target.value;
    const presets = {
      'deepseek': 'https://api.deepseek.com/v1/chat/completions',
      'gemini': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      'groq': 'https://api.groq.com/openai/v1/chat/completions',
      'openai': 'https://api.openai.com/v1/chat/completions'
    };

    if (presets[preset]) {
      document.getElementById('settings-api-url').value = presets[preset];
      // Don't touch the model field — let user type whatever they want
    }
  }

  async _onFetchModels() {
    const preset = document.getElementById('settings-api-preset').value;
    const apiKey = document.getElementById('settings-api-key').value.trim();
    const apiUrl = document.getElementById('settings-api-url').value.trim();
    const resultEl = document.getElementById('api-test-result');
    const modelInput = document.getElementById('settings-api-model');

    if (!apiKey) {
      this.ui.toast('请先填写 API Key', 'warning');
      return;
    }
    if (!apiUrl) {
      this.ui.toast('请先选择供应商或填写 Endpoint URL', 'warning');
      return;
    }

    resultEl.textContent = '正在获取模型列表...';
    resultEl.style.color = 'var(--text-muted)';

    // Try common model list endpoints
    const modelUrls = [];
    const baseUrl = apiUrl.replace(/\/chat\/completions.*$/, '').replace(/\/v1\/chat\/completions.*$/, '');
    modelUrls.push(`${baseUrl}/models`);
    modelUrls.push(`https://api.deepseek.com/v1/models`);
    modelUrls.push(`https://api.groq.com/openai/v1/models`);
    modelUrls.push(`https://api.openai.com/v1/models`);

    let fetchedModels = [];
    for (const url of modelUrls) {
      try {
        const resp = await fetch(url, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (resp.ok) {
          const data = await resp.json();
          fetchedModels = (data.data || data.models || [])
            .map(m => m.id || m.name || '')
            .filter(Boolean)
            .sort();
          if (fetchedModels.length > 0) break;
        }
      } catch (e) {
        // Try next URL
      }
    }

    if (fetchedModels.length > 0) {
      // Create a datalist for the model input
      let datalist = document.getElementById('model-datalist');
      if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'model-datalist';
        modelInput.setAttribute('list', 'model-datalist');
        modelInput.parentNode.appendChild(datalist);
      }
      datalist.innerHTML = fetchedModels.map(m => `<option value="${m}">`).join('');
      modelInput.value = fetchedModels[0];
      resultEl.innerHTML = `✓ 找到 ${fetchedModels.length} 个模型，已填入第一个。<br><small>点击输入框可查看全部</small>`;
      resultEl.style.color = 'var(--success)';
    } else {
      resultEl.textContent = '⚠ 未能自动获取模型列表，请手动输入模型名称';
      resultEl.style.color = 'var(--warning)';
    }
  }

  async _onTestAPI() {
    // Save current settings first
    const settings = {
      apiKey: document.getElementById('settings-api-key').value.trim(),
      apiUrl: document.getElementById('settings-api-url').value.trim(),
      apiModel: document.getElementById('settings-api-model').value.trim()
    };
    this.api.saveSettings(settings);

    const resultEl = document.getElementById('api-test-result');
    resultEl.textContent = '测试中...';
    resultEl.style.color = 'var(--text-muted)';

    try {
      await this.api.testConnection();
      resultEl.textContent = '✓ 连接成功！';
      resultEl.style.color = 'var(--success)';
    } catch (e) {
      resultEl.textContent = `✗ ${e.message}`;
      resultEl.style.color = 'var(--danger)';
    }
  }

  // --- Data Management ---
  async _onExportAll() {
    try {
      const data = await this.storage.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nightread-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.ui.toast('数据导出成功 ✓', 'success');
    } catch (e) {
      this.ui.toast(`导出失败: ${e.message}`, 'error');
    }
  }

  async _onImportAll(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await this.storage.importAll(data);
      await this.storage.init(); // Re-initialize after import
      this.ui.toast('数据导入成功 ✓', 'success');
      await this._refreshLibrary();
    } catch (e) {
      this.ui.toast(`导入失败: ${e.message}`, 'error');
    }

    e.target.value = '';
  }

  async _onClearAll() {
    this.ui.showModal(
      '确认清除',
      '<p>这将删除所有小说、章节和设定数据。<strong>此操作不可恢复。</strong></p>',
      `
        <button class="btn-secondary" onclick="window._app.ui.hideModal()">取消</button>
        <button class="btn-danger" id="confirm-clear">确认清除</button>
      `
    );

    document.getElementById('confirm-clear').addEventListener('click', async () => {
      try {
        await this.storage.clearAll();
        await this.storage.init();
        this.ui.hideModal();
        this.ui.toast('所有数据已清除', 'success');
        await this._refreshLibrary();
      } catch (e) {
        this.ui.toast(`清除失败: ${e.message}`, 'error');
      }
    });
  }

  // --- Novel Management ---
  _startNewNovel() {
    if (!this.api.isConfigured()) {
      this.ui.toast('请先在设置中配置 API Key', 'warning');
      this._navigateToSettings();
      return;
    }

    this.ui.resetWizard();
    this._showApp();
    this.ui.navigateTo('setup');
  }

  openNovel(novelId) {
    this._loadNovelForReading(novelId);
  }

  async deleteNovelPrompt(novelId) {
    const novel = await this.storage.getNovel(novelId);
    const title = novel?.title || '未命名';

    this.ui.showModal(
      '删除小说',
      `<p>确定要删除《${this.ui._escape(title)}》吗？<br>所有相关章节和设定也会被删除。此操作不可恢复。</p>`,
      `
        <button class="btn-secondary" onclick="window._app.ui.hideModal()">取消</button>
        <button class="btn-danger" id="confirm-delete">确认删除</button>
      `
    );

    document.getElementById('confirm-delete').addEventListener('click', async () => {
      await this.storage.deleteNovel(novelId);
      this.ui.hideModal();
      this.ui.toast('已删除', 'info');
      if (this.currentNovel?.id === novelId) {
        this.currentNovel = null;
        this._navigateToLibrary();
      }
      await this._refreshLibrary();
    });
  }

  // --- Wizard Flow ---
  async _onWizardGenerate() {
    const prefs = this.ui.getWizardPrefs();
    if (!prefs.title) {
      this.ui.toast('请为小说取一个标题', 'warning');
      return;
    }

    this.ui._setWizardStep(2);

    // --- Generate Bible ---
    this.ui.showGenStatus('正在生成世界观设定...');
    try {
      let bibleJSON = '';
      const bible = await this.engine.generateBible(prefs, (token, full) => {
        bibleJSON = full;
        this.ui.showGenStatus(`正在生成世界观设定... 已生成 ${full.length} 字`);
      });

      // --- Generate Outline ---
      this.ui.showGenStatus('世界观生成完成，正在规划故事大纲...');
      let outlineJSON = '';
      const outline = await this.engine.generateOutline(bible, prefs, (token, full) => {
        outlineJSON = full;
        this.ui.showGenStatus(`正在规划故事大纲... 已生成 ${full.length} 字`);
      });

      // Store generated data temporarily
      this._pendingBible = bible;
      this._pendingOutline = outline;
      this._pendingPrefs = prefs;

      this.ui.showGenResults(
        JSON.stringify(bible, null, 2),
        JSON.stringify(outline, null, 2),
        true
      );

      this.ui.toast('世界观和大纲生成完成！你可以编辑后再开始阅读', 'success');

    } catch (e) {
      console.error('Generation failed:', e);
      this.ui.toast(`生成失败: ${e.message}`, 'error');
      this.ui._setWizardStep(1);
    }
  }

  async _onWizardRegenerate() {
    this.ui.showGenStatus('正在重新生成...');
    this._onWizardGenerate();
  }

  async _onWizardStartRead() {
    // Parse edited bible and outline
    let bible, outline;

    try {
      const bibleText = this.ui.getEditedBible();
      bible = JSON.parse(bibleText);
    } catch (e) {
      bible = this._pendingBible;
    }

    try {
      const outlineText = this.ui.getEditedOutline();
      outline = JSON.parse(outlineText);
    } catch (e) {
      outline = this._pendingOutline;
    }

    if (!bible || !outline) {
      this.ui.toast('设定数据不完整，请重新生成', 'error');
      return;
    }

    const prefs = this._pendingPrefs;
    if (!prefs) {
      this.ui.toast('请先完成偏好设置', 'error');
      return;
    }

    // Create novel in DB
    const novel = {
      id: this._generateId(),
      title: prefs.title,
      genre: prefs.genre,
      tropes: prefs.tropes,
      style: prefs.style,
      createdAt: new Date().toISOString(),
      lastReadChapter: 0,
      totalChapters: outline.nodes?.length || 15
    };

    await this.storage.saveNovel(novel);

    // Save bible
    bible.novelId = novel.id;
    await this.storage.saveBible(bible);

    // Save outline
    outline.novelId = novel.id;
    await this.storage.saveOutline(outline);

    // Set current context
    this.currentNovel = novel;
    this.currentBible = bible;
    this.currentOutline = outline;
    this.currentChapters = [];
    this.currentChapterNum = 1;

    // Navigate to reader and generate chapter 1
    this._navigateToReader();
    this._updateReaderSidebar();
    await this._generateChapter(1, outline.nodes[0]?.id || 'node_1', null);
  }

  // --- Reader Flow ---
  async _loadNovelForReading(novelId) {
    const novel = await this.storage.getNovel(novelId);
    if (!novel) {
      this.ui.toast('小说不存在', 'error');
      return;
    }

    const bible = await this.storage.getBible(novelId);
    const outline = await this.storage.getOutline(novelId);
    const chapters = await this.storage.getChapters(novelId);

    this.currentNovel = novel;
    this.currentBible = bible;
    this.currentOutline = outline;
    this.currentChapters = chapters;
    this.currentChapterNum = novel.lastReadChapter || 1;

    this._navigateToReader();
    this._updateReaderSidebar();

    // Load the last read chapter
    const chapter = chapters.find(c => c.chapterNumber === this.currentChapterNum);
    if (chapter) {
      this.ui.showReader(novel, chapter);
      const outlineNode = this.currentOutline?.nodes?.[this.currentChapterNum - 1] || null;
      this.ui.showChoices(chapter.choices, this.currentChapterNum, outlineNode);
    } else {
      this.ui.showReader(novel, { chapterNumber: this.currentChapterNum });
      // Auto-generate if not exists
      const nodeId = outline?.nodes?.[this.currentChapterNum - 1]?.id;
      if (nodeId) {
        await this._generateChapter(this.currentChapterNum, nodeId, null);
      }
    }
  }

  _updateReaderSidebar() {
    this.ui.updateOutlineProgress(this.currentOutline, this.currentChapterNum, this.currentChapters);
    this.ui.updateCharacterList(this.currentBible);
    this.ui.updateWorldRules(this.currentBible);
  }

  async _generateChapter(chapterNum, nodeId, choiceText) {
    if (this.isGenerating) return;
    this.isGenerating = true;

    // === LAZY CACHE CHECK ===
    // Only use cache when re-opening a novel (no choice/direction given)
    // When reader makes a choice, always regenerate to reflect that choice
    if (!choiceText && this.currentNovel) {
      const existing = await this.storage.getChapter(this.currentNovel.id, chapterNum);
      if (existing && existing.content) {
        this.ui.showReader(this.currentNovel, existing);
        const outlineNode = this.currentOutline?.nodes?.[chapterNum - 1] || null;
        this.ui.showChoices(existing.choices, chapterNum, outlineNode);
        this.ui.showTypingIndicator(false);
        this.currentChapterNum = chapterNum;
        this._updateReaderSidebar();
        this.isGenerating = false;
        return;
      }
    }

    // Find previous chapter summary
    let previousSummary = '';
    let previousChapterFull = '';

    if (chapterNum > 1) {
      const prevChapter = this.currentChapters.find(c => c.chapterNumber === chapterNum - 1);
      if (prevChapter) {
        previousSummary = prevChapter.summary || '';
        previousChapterFull = prevChapter.content || '';
      }
    }

    // Update UI
    const chapterTitle = this.currentOutline?.nodes?.find(n => n.id === nodeId)?.title || `第 ${chapterNum} 章`;
    document.getElementById('reader-chapter-num').textContent = `第 ${chapterNum} 章`;
    document.getElementById('chapter-title').textContent = chapterTitle;
    document.getElementById('chapter-body').innerHTML = '<p class="text-muted">AI 正在构思...</p>';
    document.getElementById('reader-choices').innerHTML = '';
    this.ui.showTypingIndicator(true);
    this._updateReaderSidebar();

    try {
      const result = await this.engine.generateChapter(
        this.currentBible,
        this.currentOutline,
        this.currentNovel,
        chapterNum,
        nodeId,
        choiceText,
        previousSummary,
        previousChapterFull,
        (token, full) => {
          // Remove "preparing" text on first token
          this.ui.appendChapterToken(token);
        }
      );

      this.ui.showTypingIndicator(false);

      // Generate summary
      let summary = '';
      try {
        summary = await this.engine.generateSummary(result.content);
      } catch (e) {
        console.warn('Summary generation failed:', e);
      }

      // Build chapter object
      const chapter = {
        id: `${this.currentNovel.id}_ch_${chapterNum}`,
        novelId: this.currentNovel.id,
        chapterNumber: chapterNum,
        title: chapterTitle,
        content: result.content,
        summary: summary,
        choices: result.choices,
        readerChoice: choiceText || null
      };

      await this.storage.saveChapter(chapter);

      // Update current chapters list
      const existingIdx = this.currentChapters.findIndex(c => c.chapterNumber === chapterNum);
      if (existingIdx >= 0) {
        this.currentChapters[existingIdx] = chapter;
      } else {
        this.currentChapters.push(chapter);
        this.currentChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
      }

      // Update novel progress
      this.currentNovel.lastReadChapter = chapterNum;
      this.currentNovel.totalChapters = Math.max(
        this.currentNovel.totalChapters || 0,
        this.currentOutline?.nodes?.length || chapterNum
      );
      await this.storage.saveNovel(this.currentNovel);

      // Update UI
      document.getElementById('chapter-title').textContent = chapterTitle;
      const genNode = this.currentOutline?.nodes?.find(n => n.id === nodeId) || null;
      this.ui.showChoices(result.choices, chapterNum, genNode);
      this._updateReaderSidebar();

      // Handle ending
      if (genNode?.isEnding) {
        setTimeout(() => {
          this.ui.toast('🎉 故事完结！感谢阅读', 'success');
        }, 500);
      }

    } catch (e) {
      console.error('Chapter generation failed:', e);
      this.ui.showTypingIndicator(false);
      document.getElementById('chapter-body').innerHTML = `<p class="text-muted">生成失败: ${this.ui._escape(e.message)}</p>`;
      this.ui.toast(`生成失败: ${e.message}`, 'error');
    } finally {
      this.isGenerating = false;
    }
  }

  async _onChoicesClick(e) {
    if (this.isGenerating) return;

    // 自定义输入提交
    if (e.target.id === 'btn-custom-choice') {
      const input = document.getElementById('custom-choice-input');
      const text = input?.value?.trim();
      if (!text) return;
      const nextNodeId = this.currentOutline?.nodes?.[this.currentChapterNum]?.id ||
                         this.currentOutline?.nodes?.[this.currentChapterNum - 1]?.id ||
                         'continue';
      this.currentChapterNum++;
      await this._generateChapter(this.currentChapterNum, nextNodeId, `读者要求：${text}`);
      return;
    }

    // 分支选项/下一章按钮 — 用 matches 兜底查 target 和 parent
    const target = e.target;
    let btn = null;
    if (target.matches?.('.choice-btn, .next-chapter-btn')) {
      btn = target;
    } else if (target.parentElement?.matches?.('.choice-btn, .next-chapter-btn')) {
      btn = target.parentElement;
    } else {
      btn = target.closest('.choice-btn, .next-chapter-btn');
    }
    if (!btn) return;

    // "阅读下一章" — 无选择，直接继续
    if (btn.dataset.action === 'next-chapter') {
      const nextNodeId = this.currentOutline?.nodes?.[this.currentChapterNum]?.id;
      if (!nextNodeId) {
        this.ui.toast('大纲已到尽头', 'info');
        return;
      }
      this.currentChapterNum++;
      await this._generateChapter(this.currentChapterNum, nextNodeId, null);
      return;
    }

    // 分支选择
    const choiceId = btn.dataset.choiceId;
    // 从按钮文本提取选择描述（去掉前面的标记字符）
    const choiceText = btn.textContent?.replace(/^[①②③]\s*/, '').trim() || '';

    // 动态重写后续大纲
    const currentNode = this.currentOutline?.nodes?.[this.currentChapterNum - 1];
    if (choiceText && this.currentOutline?.nodes?.length) {
      try {
        const newOutline = await this.engine.rewriteOutline(
          this.currentBible,
          this.currentOutline,
          currentNode?.id,
          choiceText,
          this.currentNovel
        );
        this.currentOutline = newOutline;
        await this.storage.saveOutline({ novelId: this.currentNovel.id, ...newOutline });
        this._updateReaderSidebar();
      } catch (e) {
        console.warn('Outline rewrite failed:', e);
      }
    }

    // 确定下一节点
    let nextNodeId;
    if (currentNode?.choices) {
      const matched = currentNode.choices.find(c => c.id === choiceId);
      if (matched?.nextNodeId) nextNodeId = matched.nextNodeId;
    }
    if (!nextNodeId) {
      nextNodeId = this.currentOutline?.nodes?.[this.currentChapterNum]?.id;
    }
    if (!nextNodeId) {
      this.ui.toast('大纲已到尽头', 'info');
      return;
    }

    this.currentChapterNum++;
    await this._generateChapter(this.currentChapterNum, nextNodeId, choiceText);
  }

  async _onDownloadBook() {
    if (!this.currentNovel) {
      this.ui.toast('没有可下载的书籍', 'warning');
      return;
    }

    const novel = this.currentNovel;
    const bible = this.currentBible;
    const outline = this.currentOutline;
    const chapters = this.currentChapters?.filter(c => c.content) || [];

    // 组装全书数据
    const book = {
      title: novel.title,
      genre: novel.genre,
      style: novel.style,
      tropes: novel.tropes,
      createdAt: novel.createdAt,
      totalChapters: chapters.length,
      bible: bible ? {
        worldSetting: bible.worldSetting,
        worldRules: bible.worldRules,
        atmosphere: bible.atmosphere,
        factions: bible.factions,
        characters: bible.characters
      } : null,
      outline: outline ? {
        nodes: outline.nodes?.map(n => ({
          id: n.id, title: n.title, summary: n.summary
        }))
      } : null,
      chapters: chapters.sort((a, b) => a.chapterNumber - b.chapterNumber).map(c => ({
        chapterNumber: c.chapterNumber,
        title: c.title,
        content: c.content,
        summary: c.summary,
        choices: c.choices
      }))
    };

    // 生成文本版
    let text = `${novel.title}\n${'═'.repeat(novel.title.length)}\n\n`;
    text += `题材：${novel.genre || '未设定'}\n`;
    text += `文风：${novel.style || '未设定'}\n`;
    if (novel.tropes?.length) text += `元素：${novel.tropes.join('、')}\n`;
    text += `章节数：${chapters.length}\n\n`;

    for (const ch of book.chapters) {
      text += `\n${'─'.repeat(40)}\n`;
      text += `第 ${ch.chapterNumber} 章 ${ch.title || ''}\n`;
      text += `${'─'.repeat(40)}\n\n`;
      text += ch.content + '\n\n';
      if (ch.summary) text += `[本章概要] ${ch.summary}\n\n`;
    }

    // 下载为 .txt
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${novel.title || '未命名'}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    this.ui.toast(`已下载《${novel.title}》共 ${chapters.length} 章 ✓`, 'success');
  }

  async _onOutlineNodeClick(e) {
    const nodeEl = e.target.closest('.outline-node.clickable');
    if (!nodeEl || this.isGenerating) return;

    const chapterNum = parseInt(nodeEl.dataset.chapter);
    if (!chapterNum || isNaN(chapterNum)) return;

    // 如果是当前正在看的章节，不跳转
    if (chapterNum === this.currentChapterNum) return;

    // 检查该章节是否已缓存
    const chapter = this.currentChapters.find(c => c.chapterNumber === chapterNum);
    if (!chapter || !chapter.content) {
      this.ui.toast('该章节尚未生成', 'info');
      return;
    }

    // 跳转到已缓存的章节
    this.currentChapterNum = chapterNum;
    this.ui.showReader(this.currentNovel, chapter);
    this._updateReaderSidebar();

    // 显示该章节已有的选择（如果有的话）
    const outlineNode = this.currentOutline?.nodes?.[chapterNum - 1] || null;
    this.ui.showChoices(chapter.choices, chapterNum, outlineNode);
  }

  // --- Helpers ---
  _generateId() {
    return 'novel_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  _handleResize() {
    if (this.currentView === 'reader' && window.innerWidth > 900) {
      document.getElementById('reader-sidebar').style.display = this.ui.sidebarOpen ? '' : 'none';
      document.getElementById('sidebar-overlay').classList.add('hidden');
    }
  }
}

// ==================== BOOTSTRAP ====================
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(e => {
    console.error('App init failed:', e);
  });
});
