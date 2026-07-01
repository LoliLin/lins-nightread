/* ============================================================
   Lin's NightRead — Complete Application Logic
   ============================================================ */
// ==================== STORAGE MANAGER ====================
class StorageManager {
    constructor() {
        this.dbName = 'nightread-db';
        this.dbVersion = 3;
        this.db = null;
    }
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('novels')) {
                    const novelsStore = db.createObjectStore('novels', {
                        keyPath: 'id'
                    });
                    novelsStore.createIndex('createdAt', 'createdAt', {
                        unique: false
                    });
                }
                if (!db.objectStoreNames.contains('bibles')) {
                    db.createObjectStore('bibles', {
                        keyPath: 'novelId'
                    });
                }
                if (!db.objectStoreNames.contains('outlines')) {
                    db.createObjectStore('outlines', {
                        keyPath: 'novelId'
                    });
                }
                if (!db.objectStoreNames.contains('chapters')) {
                    const chaptersStore = db.createObjectStore('chapters', {
                        keyPath: 'id'
                    });
                    chaptersStore.createIndex('novelId', 'novelId', {
                        unique: false
                    });
                    chaptersStore.createIndex('novelId_chapter',
                        ['novelId', 'chapterNumber'], {
                            unique: true
                        });
                    chaptersStore.createIndex('novelId_branch',
                        ['novelId', 'branchId', 'chapterNumber'], {
                            unique: true
                        });
                }
                if (db.objectStoreNames.contains('chapters')) {
                    // DB v2→3: remove unique constraint on novelId_chapter so branches can coexist
                    try {
                        const chaptersStore = e.target.transaction.objectStore('chapters');
                        if (chaptersStore.indexNames.contains('novelId_chapter')) {
                            chaptersStore.deleteIndex('novelId_chapter');
                            chaptersStore.createIndex('novelId_chapter',
                                ['novelId', 'chapterNumber'], {
                                    unique: false
                                });
                        }
                    } catch (e) {
                        console.warn('Index migration note:', e);
                    }
                }
                if (!db.objectStoreNames.contains('branches')) {
                    const branchesStore = db.createObjectStore('branches', {
                        keyPath: 'id'
                    });
                    branchesStore.createIndex('novelId', 'novelId', {
                        unique: false
                    });
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
        const tx = this.db.transaction(['novels', 'bibles', 'outlines', 'chapters', 'branches'], 'readwrite');
        tx.objectStore('novels').delete(id);
        tx.objectStore('bibles').delete(id);
        tx.objectStore('outlines').delete(id);
        // Delete all chapters for this novel
        const chaptersStore = tx.objectStore('chapters');
        const chIndex = chaptersStore.index('novelId');
        const chCursorReq = chIndex.openCursor(IDBKeyRange.only(id));
        chCursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                chaptersStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };
        // Delete all branches for this novel
        const branchesStore = tx.objectStore('branches');
        const brIndex = branchesStore.index('novelId');
        const brCursorReq = brIndex.openCursor(IDBKeyRange.only(id));
        brCursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                branchesStore.delete(cursor.primaryKey);
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
        return this._promisify(index.get([novelId,
            chapterNumber
        ]));
    }
    async saveChapter(chapter) {
        const store = this._store('chapters', 'readwrite');
        return this._promisify(store.put(chapter));
    }
    async getChaptersByBranch(novelId, branchId) {
        const store = this._store('chapters');
        const index = store.index('novelId');
        const all = await this._promisify(index.getAll(novelId));
        return all.filter(c => c.branchId === branchId).sort((a, b) => a.chapterNumber - b.chapterNumber);
    }
    // --- Branches ---
    async getBranches(novelId) {
        const store = this._store('branches');
        const index = store.index('novelId');
        const branches = await this._promisify(index.getAll(novelId));
        return branches.sort((a, b) => a.createdAt - b.createdAt);
    }
    async saveBranch(branch) {
        const store = this._store('branches', 'readwrite');
        return this._promisify(store.put(branch));
    }
    async exportAll() {
        const novels = await this.getAllNovels();
        const data = {
            novels,
            bibles: [],
            outlines: [],
            chapters: [],
            branches: []
        };
        for (const novel of novels) {
            const bible = await this.getBible(novel.id);
            if (bible) data.bibles.push(bible);
            const outline = await this.getOutline(novel.id);
            if (outline) data.outlines.push(outline);
            const chapters = await this.getChapters(novel.id);
            data.chapters.push(...chapters);
            const branches = await this.getBranches(novel.id);
            data.branches.push(...branches);
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
        if (data.branches) {
            for (const branch of data.branches) await this.saveBranch(branch);
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
        } catch (e) {
            /* ignore */
        }
        return {
            apiKey: '',
            apiUrl: 'https://api.deepseek.com/v1/chat/completions',
            apiModel: 'deepseek-chat',
            reasoner: false
        };
    }
    saveSettings(settings) {
        this.settings = {
            ...this.settings,
            ...settings
        };
        localStorage.setItem('nightread_settings', JSON.stringify(this.settings));
    }
    getSettings() {
        return {
            ...this.settings
        };
    }
    isConfigured() {
        return !!(this.settings.apiKey && this.settings.apiUrl);
    }
    getMaxContextChars() {
        // 根据供应商估算可用上下文预算（留余量给模型回复）
        const url = this.settings.apiUrl || '';
        if (url.includes('google') || url.includes('gemini')) return 500000;
        if (url.includes('deepseek')) return 80000;
        if (url.includes('groq')) return 80000;
        if (url.includes('openai')) return 80000;
        if (url.includes('anthropic') || url.includes('claude')) return 80000;
        return 32000; // 未知模型保守值
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
                    messages: [{
                        role: 'user',
                        content: 'Hello, respond with just "ok".'
                    }],
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
            stream: true,
            stream_options: { include_usage: true },
        };
        if (this.settings.reasoner) {
            body.reasoning_effort = 'high';
            body.extra_body = {
                thinking: {
                    type: 'enabled'
                }
            };
        }
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
                        } catch (e) {
                            errMsg += `: ${errText.slice(0, 100)}`;
                        }
                    }
                    throw new Error(errMsg);
                }
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                while (true) {
                    const {
                        done,
                        value
                    } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, {
                        stream: true
                    });
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

                            if (json.usage) finalUsage = json.usage;
                        } catch (e) {
                            // Skip unparseable lines
                        }
                    }
                }
                // Process remaining buffer
                let finalUsage = null;
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
                        if (json.usage) finalUsage = json.usage;
                    } catch (e) {
                        /* ignore */
                    }
                }
                if (onDone) onDone(fullText, finalUsage);
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
        const messages = [{
            role: 'system',
            content: systemPrompt
        }, {
            role: 'user',
            content: userPrompt
        }];
        let rawText = '';
        const result = await this.api.streamChat(messages, {
            temperature: 0.9,
            maxTokens: 65535,
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
        const bibleSummary = bible;
        const systemPrompt = `你是一个专业的小说大纲设计师。根据已有的世界观设定，生成一个包含 12-18 个节点的分支故事大纲。

请严格按照以下 JSON 格式输出：

{
  "nodes": [
    {
      "id": "node_1",
      "title": "节点标题",
      "summary": "本章节的故事概要（50-100字）",
      "isEnding": false
    }
  ]
}

要求：
- 节点数量 12-18 个，若要求复杂可适当延长
- 故事要有起伏，遵循三幕结构
- 最后一个节点的 isEnding 为 true
- 分支要合理汇合，形成网状结构
- 中文输出`;
        const userPrompt = `世界观概要：
${bibleSummary}

小说标题：${prefs.title || '未命名'}
题材：${prefs.genre || '不限'}
文风：${prefs.style || '不限'}

请生成故事大纲，直接输出 JSON。`;
        const messages = [{
            role: 'system',
            content: systemPrompt
        }, {
            role: 'user',
            content: userPrompt
        }];
        let rawText = '';
        await this.api.streamChat(messages, {
            temperature: 0.9,
            maxTokens: 65535,
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
                try {
                    return JSON.parse(match[0]);
                } catch (e2) {
                    throw new Error(`无法解析大纲 JSON: ${e.message}`);
                }
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
    async generateChapter(bible, outline, novel, chapterNumber, nodeId, previousSummary, previousChapterFull, onToken = null, branchPrompt = null, storyNotes = '') {
        const bibleContext = this._formatBibleContext(bible);
        const node = outline.nodes?.find(n => n.id === nodeId) || {};
        const nodeInfo = `本章大纲节点：${node.title || '待定'}\n本章概要：${node.summary || '根据故事自然发展'}`;
        const systemPrompt = `你是一个专业的小说作家。根据以下完整的设定和大纲，写出精彩的小说章节。
【设定】
${bibleContext}
【大纲】
${JSON.stringify(outline.nodes)}
【写作要求】
- 题材：${novel.genre || '不限'}
- 文风：${novel.style || '文学性'}
- 描写细腻，对话生动，情节推进有力
- 使用中文写作
- 章节正文写完后，用 <Note> 标签附上本章的故事笔记，格式如下：
  <Note>
  ## 关键事件
  - 具体的人物行动、对话交锋、场景变化
  ## 角色状态变化
  - 角色名: 心态、关系变化
  ## 已揭示的信息
  - 本章揭露的秘密、世界观设定
  ## 未解决的线索
  - 悬而未决的问题
  ## 后续建议
  - 1-3 个合理发展方向
  </Note>`;
        const contextParts = [];
        contextParts.push(`【本章大纲】\n${nodeInfo}`);
        if (branchPrompt) {
            contextParts.push(`【分支创作方向】\n${branchPrompt}`);
        }
        if (storyNotes) {
            contextParts.push(`【累积故事笔记】\n${storyNotes}`);
        }
        if (previousChapterFull) {
            // 上一章最后 3000 字保持叙事连贯
            contextParts.push(`【上一章结尾】\n${previousChapterFull.slice(-3000)}`);
        }
        contextParts.push(`请写出《${novel.title || '未命名'}》的第 ${chapterNumber} 章。`);
        contextParts.push(`请开始写作。`);
        const userPrompt = contextParts.join('\n\n');
        const messages = [{
            role: 'system',
            content: systemPrompt
        }, {
            role: 'user',
            content: userPrompt
        }];
        let rawText = '';
        let chapterUsage = null;
        await this.api.streamChat(messages, {
            temperature: 0.85,
            maxTokens: 65535,
            onToken: (token, full) => {
                rawText = full;
                if (onToken) onToken(token, full);
            },
            onDone: (full, usage) => {
                chapterUsage = usage;
            }
        });
        const parsed = this._parseChapter(rawText);
        parsed.usage = chapterUsage;
        return parsed;
    }
    _parseChapter(text) {
        if (!text || !text.trim()) {
            return {
                content: '（生成内容为空，请重试）'
            };
        }
        // Parse story notes — 只认 <Note> 标签，避免误匹配正文中的 --- 或 **
        const noteTag = '<Note>';
        const closeTag = '</Note>';
        const openIdx = text.indexOf(noteTag);
        const closeIdx = text.indexOf(closeTag);
        let content = text.trim();
        let notes = '';
        if (openIdx !== -1) {
            content = text.slice(0, openIdx).trim();
            if (closeIdx !== -1) {
                notes = text.slice(openIdx + noteTag.length, closeIdx).trim();
            } else {
                notes = text.slice(openIdx + noteTag.length).trim();
            }
        }
        return {
            content,
            notes
        };
    }
}
// ==================== UI MANAGER ====================
class UIManager {
    constructor() {
        this.currentView = 'splash';
        this.currentNovelId = null;
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
        } catch (e) {
            /* ignore */
        }
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
    renderLibrary(novels, novel2TokenMap) {
        const grid = document.getElementById('library-grid');
        const empty = document.getElementById('library-empty');
        
        if (!novels || novels.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        const htmlParts = 
            novels.map((novel) => {

                let tokenStr = null;
                if (novel2TokenMap[novel.id]) {

                    let tokens = novel2TokenMap[novel.id] || 0;
                    tokenStr = tokens > 0
                        ? tokens >= 1000
                            ? (tokens / 1000).toFixed(1) + 'k'
                            : tokens.toString()
                        : '';
                }
                

                return `
                    <div class="novel-card" data-novel-id="${novel.id}" onclick="window._app.openNovel('${novel.id}')">
                        <button class="novel-card-delete" onclick="event.stopPropagation(); window._app.deleteNovelPrompt('${novel.id}')" title="删除">✕</button>
                            <div class="novel-card-title">${this._escape(novel.title || '未命名')}</div>
                                <div class="novel-card-meta">
                                    ${novel.genre ? `<span>${this._escape(novel.genre)}</span>` : ''}
                                    ${novel.style ? `<span>${this._escape(novel.style)}</span>` : ''}
                                    ${novel.tropes?.length ? `<span>${this._escape(novel.tropes.slice(0, 2).join('·'))}</span>` : ''}
                                    ${tokenStr ? `<span>${this._escape(tokenStr)} tokens</span>` : ''}
                                </div>
                                <div class="novel-card-progress">
                                    已读至第 ${novel.lastReadChapter || 0} 章 · ${novel.totalChapters || 0} 章
                                </div>
                            </div>
                        </div>
                    `;
                });
        grid.innerHTML = htmlParts.join('');
       
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
        document.getElementById('novel-style').value = ''; // now a text input, datalist is just suggestions
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
            extra: document.getElementById('novel-extra').value.trim(),
            branchName: document.getElementById('novel-branch-name')?.value?.trim() || ''
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
        // 清空底部操作区，等展示时再填
        document.getElementById('reader-choices').innerHTML = '';
        document.getElementById('nav-reader-tab').style.display = '';
        document.getElementById('reader-main').scrollTop = 0;
        // 更新分支标签
        const badge = document.getElementById('branch-badge');
        // 只在子分支显示分支标签
        const isSubBranch = window._app?.currentBranchId && window._app?.currentBranchId.includes('_branch_');
        if (isSubBranch && window._app?._allBranches) {
            const branchRec = window._app._allBranches.find(b => b.id === window._app.currentBranchId);
            const branchName = branchRec?.name || branchRec?.forkPrompt?.slice(0, 16) || window._app.currentBranchId.slice(-6);
            badge.textContent = '✤ ' + branchName;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
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
        // 流式写入时不过滤，生成完成后统一用 result.content 重新渲染
        const lastP = body.querySelector('p:last-of-type');
        if (lastP && !lastP.textContent.endsWith('\n\n')) {
            lastP.textContent += token;
        } else {
            const p = document.createElement('p');
            p.textContent = token;
            body.appendChild(p);
        }
    }
    showTypingIndicator(show) {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.toggle('hidden', !show);
        // 不自动滚动，让用户自己控制阅读位置
    }
    showReaderBottom(chapterNum, isEnding) {
        const container = document.getElementById('reader-choices');
        if (isEnding) {
            container.innerHTML = `
        <div style="text-align:center;padding:10px 0">
          <p class="text-muted" style="margin-bottom:12px">—— 本卷终 ——</p>
          <button class="btn-epilogue" data-action="epilogue">
            📖 续写后日谈
          </button>
        </div>
      `;
        } else if (window._app?.currentOutline?.nodes && chapterNum > window._app.currentOutline.nodes.length) {
            // Beyond outline = epilogue mode, show epilogue button again
            container.innerHTML = `
        <div style="text-align:center;padding:10px 0">
          <button class="btn-epilogue" data-action="epilogue">
            📖 续写后日谈 · 第${chapterNum - window._app.currentOutline.nodes.length + 1}章
          </button>
        </div>
      `;
        } else {
            container.innerHTML = `
        <button class="next-chapter-btn" data-action="next-chapter" data-chapter="${chapterNum}">
          → 生成下一章
        </button>
      `;
        }
    }
    showBranchMenu(chapterNum, x, y) {
        const menu = document.getElementById('branch-context-menu');
        menu.innerHTML = `
      <div class="branch-menu-item" data-action="fork" data-chapter="${chapterNum}">
        从此处签出新分支...
      </div>
    `;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
    }
    hideBranchMenu() {
        document.getElementById('branch-context-menu').classList.add('hidden');
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
        let html = '';
        // Outline nodes
        html += outline.nodes.map((node, i) => {
            const chNum = i + 1;
            const exists = generatedNums.has(chNum);
            if (!exists) return ''; // 未生成的不渲染
            let cls = 'clickable';
            if (chNum < currentChapterNum) cls += ' done';
            else if (chNum === currentChapterNum) cls += ' current';
            // 第一个节点默认作为"序章"显示章节号
            const label = node.title || `第 ${chNum} 章`;
            return `
        <div class="outline-node ${cls}" data-chapter="${chNum}" data-fork="true">
          <div class="node-dot"></div>
          <div class="node-title">${label}</div>
        </div>
      `;
        }).filter(Boolean).join('');
        // Epilogue chapters (后日谈)
        const epilogueChapters = generatedChapters.filter(c => c.isEpilogue);
        if (epilogueChapters.length > 0) {
            html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">';
            html += '<p style="font-size:0.75rem;color:var(--gold);margin-bottom:4px">📖 后日谈</p>';
            html += epilogueChapters.map(ch => {
                let cls = '';
                if (ch.chapterNumber < currentChapterNum) cls += 'done';
                else if (ch.chapterNumber === currentChapterNum) cls += 'current';
                return `
        <div class="outline-node ${cls}" style="opacity:0.85">
          <div class="node-dot" style="background:var(--gold)"></div>
          <div class="node-title">后日谈 · 第${ch.epilogueNum || 1}章</div>
        </div>
      `;
            }).join('');
            html += '</div>';
        }
        container.innerHTML = html || '<p class="text-muted" style="font-size:0.8rem">暂无已生成的章节</p>';
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
    updateBranchList(branches, currrentNovelId, currentBranchId) {
        const container = document.getElementById('branch-list');
        if (!branches || branches.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = branches.map(b => {
            const isMain = b.id.endsWith('_main');
            const isCurrent = b.id === currentBranchId;
            const label = isMain ? '主分支' : `✤ ${(b.name || b.forkPrompt).slice(0, 18)}${(b.name || b.forkPrompt).length > 18 ? '...' : ''}`;
            // 读取 token 用量
            const tokenKey = 'nightread_tokens_' + currrentNovelId + '_' + b.id;
            const tokens = parseInt(localStorage.getItem(tokenKey) || '0');
            const tokenStr = tokens > 0 ? (tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : tokens + '') : '';
            const detailParts = [];
            if (!isMain) detailParts.push(`第 ${b.forkChapter} 章签出`);
            if (tokenStr) detailParts.push(`${tokenStr} tokens`);
            const detail = detailParts.join(' · ');
            return `

        <div class="branch-item ${isCurrent ? 'current' : ''}" data-branch-id="${b.id}">
          <div class="branch-item-label">${label}</div>
          ${detail ? `<div class="branch-item-detail">${detail}</div>` : ''}
        </div>
      `;
        }).join('');
    }
    toggleSidebar() {
        const sidebar = document.getElementById('reader-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        sidebar.classList.toggle('open');
        overlay.classList.toggle('hidden', !sidebar.classList.contains('open'));
    }
    applyReadingPrefs() {
        const body = document.getElementById('chapter-body');
        body.style.fontSize = `${this.fontSize}px`;
        body.style.lineHeight = this.lineHeight;
    }
    initCustomDropdowns() {
        try {
            document.querySelectorAll('input[list]').forEach(input => {
                const listId = input.getAttribute('list');
                const datalist = document.getElementById(listId);
                if (!datalist) return;
                const options = Array.from(datalist.querySelectorAll('option')).map(o => o.value).filter(Boolean);
                if (options.length === 0) return;
                // 阻止浏览器原生白色 datalist 弹出
                input.removeAttribute('list');
                // 给父容器加 position:relative 以定位下拉
                const parent = input.parentElement;
                if (getComputedStyle(parent).position === 'static') {
                    parent.style.position = 'relative';
                }
                // 创建自定义下拉容器
                const dd = document.createElement('div');
                dd.className = 'custom-dropdown';
                parent.appendChild(dd);
                const renderItems = (filter = '') => {
                    const filtered = options.filter(v => !filter || v.includes(filter));
                    dd.innerHTML = filtered.map(v => `<div class="custom-dropdown-item" data-value="${this._escape(v)}">${this._escape(v)}</div>`).join('');
                };
                const show = () => {
                    renderItems(input.value);
                    dd.classList.add('show');
                };
                const hide = () => dd.classList.remove('show');
                input.addEventListener('focus', show);
                input.addEventListener('input',
                    () => {
                        if (dd.classList.contains('show')) renderItems(input.value);
                    });
                input.addEventListener('blur',
                    () => setTimeout(hide, 250));
                dd.addEventListener('mousedown',
                    (e) => {
                        e.preventDefault(); // 防止 blur 先触发
                        const item = e.target.closest('.custom-dropdown-item');
                        if (item) {
                            input.value = item.dataset.value;
                            hide();
                            input.dispatchEvent(new Event('input', {
                                bubbles: true
                            }));
                            input.dispatchEvent(new Event('change', {
                                bubbles: true
                            }));
                        }
                    });
            });
        } catch (e) {
            console.warn('Custom dropdown init failed:', e);
        }
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
        this.currentBranchId = null; // 在 _loadNovelForReading / _onWizardStartRead 中设置
        // Generation state
        this.isGenerating = false;
        // Story notes accumulator
        this.currentStoryNotes = '';
        // Epilogue (后日谈) counter
        this.epilogueCount = 0;
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
        this.ui.initCustomDropdowns();
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
            tab.addEventListener('click',
                () => {
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
            tab.addEventListener('click',
                () => {
                    document.querySelectorAll('.gen-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    document.querySelectorAll('.gen-panel').forEach(p => p.classList.remove('active'));
                    document.getElementById(`gen-panel-${tab.dataset.genTab}`)?.classList.add('active');
                });
        });
        // Reader
        document.getElementById('btn-reader-back').addEventListener('click', () => this._navigateToLibrary());
        document.getElementById('btn-toggle-sidebar').addEventListener('click', () => this.ui.toggleSidebar());
        document.getElementById('reader-choices').addEventListener('click', (e) => this._onReaderBottomClick(e));
        document.getElementById('sidebar-overlay').addEventListener('click', () => this.ui.toggleSidebar());
        document.getElementById('btn-download-book').addEventListener('click', () => this._onDownloadBook());
        document.getElementById('btn-edit-world').addEventListener('click', () => this._onEditWorld());
        document.getElementById('world-editor-save').addEventListener('click', () => this._onWorldEditorSave());
        document.getElementById('world-editor-cancel').addEventListener('click', () => this._onWorldEditorCancel());
        document.getElementById('world-editor-close').addEventListener('click', () => this._onWorldEditorCancel());
        document.getElementById('world-editor-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this._onWorldEditorCancel();
        });
        document.getElementById('outline-progress').addEventListener('click', (e) => this._onOutlineNodeClick(e));
        document.getElementById('outline-progress').addEventListener('contextmenu', (e) => this._onSidebarContextMenu(e));
        // 移动端长按 -> 签出分支
        let _longPressTimer = null;
        document.getElementById('outline-progress').addEventListener('touchstart', (e) => {
            const nodeEl = e.target.closest('.outline-node.clickable');
            if (!nodeEl) return;
            _longPressTimer = setTimeout(
                () => {
                    const touch = e.touches[0];
                    const ch = parseInt(nodeEl.dataset.chapter);
                    if (ch && !isNaN(ch)) this.ui.showBranchMenu(ch, touch.clientX, touch.clientY);
                }, 500);
        });
        document.getElementById('outline-progress').addEventListener('touchend', () => {
            if (_longPressTimer) {
                clearTimeout(_longPressTimer);
                _longPressTimer = null;
            }
        });
        document.getElementById('outline-progress').addEventListener('touchmove', () => {
            if (_longPressTimer) {
                clearTimeout(_longPressTimer);
                _longPressTimer = null;
            }
        });
        document.getElementById('branch-list').addEventListener('click', (e) => this._onBranchClick(e));
        // Close branch context menu on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#branch-context-menu')) {
                this.ui.hideBranchMenu();
            }
        });
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
            tag.addEventListener('click',
                () => tag.classList.toggle('active'));
        });
        // Branch context menu click handler
        document.getElementById('branch-context-menu').addEventListener('click', (e) => {
            const item = e.target.closest('.branch-menu-item');
            if (!item || item.dataset.action !== 'fork') return;
            const chapterNum = parseInt(item.dataset.chapter);
            if (!chapterNum || isNaN(chapterNum)) return;
            this.ui.hideBranchMenu();
            // Show the branch prompt overlay
            const overlay = document.getElementById('branch-prompt-overlay');
            overlay.classList.remove('hidden');
            document.getElementById('branch-prompt-input').value = '';
            document.getElementById('branch-prompt-input').focus();
            document.getElementById('branch-prompt-chapter').textContent = `第 ${chapterNum} 章`;
            document.getElementById('branch-prompt-submit').dataset.chapter = chapterNum;
        });
        // Branch prompt overlay buttons
        document.getElementById('branch-prompt-cancel').addEventListener('click', () => {
            document.getElementById('branch-prompt-overlay').classList.add('hidden');
        });
        document.getElementById('branch-prompt-submit').addEventListener('click', async (e) => {
            const chapterNum = parseInt(e.currentTarget.dataset.chapter);
            if (!chapterNum || isNaN(chapterNum)) {
                this.ui.toast('无法签出：章节号无效', 'error');
                return;
            }
            document.getElementById('branch-prompt-overlay').classList.add('hidden');
            try {
                await this._onBranchSubmit(chapterNum);
            } catch (err) {
                console.error('Branch submit failed:', err);
                this.ui.toast(`签出失败: ${err.message}`, 'error');
            }
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
        const novelId2Token = {}; 
        
        for (const novel of novels) {
            const branches = await this.storage.getBranches(novel.id);
            let tokens = 0;
            for (const b of branches) {
                const tokenKey = `nightread_tokens_${novel.id}_${b.id}`;
                tokens += parseInt(localStorage.getItem(tokenKey) || '0', 10);
            }
            novelId2Token[novel.id] = tokens;
        }

        this.ui.renderLibrary(novels, novelId2Token);
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
        document.getElementById('settings-reasoner').checked = settings.reasoner || false;
        document.getElementById('settings-font-size').value = this.ui.fontSize;
        document.getElementById('font-size-value').textContent = `${this.ui.fontSize}px`;
        document.getElementById('settings-line-height').value = this.ui.lineHeight;
        document.getElementById('line-height-value').textContent = this.ui.lineHeight.toFixed(1);
    }
    async _onSaveSettings() {
        const settings = {
            apiKey: document.getElementById('settings-api-key').value.trim(),
            apiUrl: document.getElementById('settings-api-url').value.trim(),
            apiModel: document.getElementById('settings-api-model').value.trim(),
            reasoner: document.getElementById('settings-reasoner').checked
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
        try {
            console.log('[NightRead] Fetch models clicked');
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
                        headers: {
                            'Authorization': `Bearer ${apiKey}`
                        }
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        fetchedModels = (data.data || data.models || []).map(m => m.id || m.name || '').filter(Boolean).sort();
                        if (fetchedModels.length > 0) break;
                    }
                } catch (e) {
                    // Try next URL
                }
            }
            if (fetchedModels.length > 0) {
                modelInput.value = fetchedModels[0];
                // Ensure model input has a styled custom dropdown
                const existingWrapper = modelInput.closest('.model-dropdown-wrapper');
                if (existingWrapper) existingWrapper.remove();
                const wrapper = document.createElement('div');
                wrapper.className = 'model-dropdown-wrapper';
                wrapper.style.position = 'relative';
                wrapper.style.display = 'inline-block';
                wrapper.style.width = '100%';
                modelInput.parentNode.insertBefore(wrapper, modelInput);
                wrapper.appendChild(modelInput);
                const dd = document.createElement('div');
                dd.className = 'custom-dropdown';
                dd.innerHTML = fetchedModels.map(m => `<div class="custom-dropdown-item" data-value="${m}">${m}</div>`).join('');
                wrapper.appendChild(dd);
                let isOpen = false;
                const showModels = () => {
                    dd.innerHTML = fetchedModels.map(m => `<div class="custom-dropdown-item" data-value="${m}">${m}</div>`).join('');
                    dd.classList.add('show');
                    isOpen = true;
                };
                modelInput.addEventListener('focus', showModels);
                modelInput.addEventListener('blur',
                    () => setTimeout(
                        () => {
                            dd.classList.remove('show');
                            isOpen = false;
                        }, 200));
                dd.addEventListener('mousedown',
                    (e) => {
                        const item = e.target.closest('.custom-dropdown-item');
                        if (item) {
                            modelInput.value = item.dataset.value;
                            dd.classList.remove('show');
                            isOpen = false;
                            modelInput.dispatchEvent(new Event('input', {
                                bubbles: true
                            }));
                        }
                    });
                modelInput.focus();
                modelInput.select();
                resultEl.innerHTML = `✓ 找到 ${fetchedModels.length} 个模型`;
                resultEl.style.color = 'var(--success)';
            } else {
                resultEl.textContent = '⚠ 未能自动获取模型列表，请手动输入模型名称';
                resultEl.style.color = 'var(--warning)';
            }
        } catch (e) {
            console.error('[NightRead] Fetch models error:', e);
            this.ui.toast(`获取模型失败: ${e.message}`, 'error');
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
            const blob = new Blob([
                JSON.stringify(data, null, 2)
            ], {
                type: 'application/json'
            });
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
        this.ui.showModal('确认清除', '<p>这将删除所有小说、章节和设定数据。<strong>此操作不可恢复。</strong></p>', `
        <button class="btn-secondary" onclick="window._app.ui.hideModal()">取消</button>
        <button class="btn-danger" id="confirm-clear">确认清除</button>
      `);
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
        this.ui.showModal('删除小说', `<p>确定要删除《${this.ui._escape(title)}》吗？<br>所有相关章节和设定也会被删除。此操作不可恢复。</p>`, `
        <button class="btn-secondary" onclick="window._app.ui.hideModal()">取消</button>
        <button class="btn-danger" id="confirm-delete">确认删除</button>
      `);
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
            this.ui.showGenResults(JSON.stringify(bible, null, 2), JSON.stringify(outline, null, 2), true);
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
        // Create 'main' branch
        const branchNameInput = document.getElementById('novel-branch-name')?.value?.trim();
        const mainBranch = {
            id: novel.id + '_main',
            novelId: novel.id,
            parentBranchId: null,
            forkChapter: 0,
            forkPrompt: branchNameInput || '主分支',
            createdAt: Date.now()
        };
        await this.storage.saveBranch(mainBranch);
        // Set current context
        this.currentNovel = novel;
        this.currentBible = bible;
        this.currentOutline = outline;
        this.currentChapters = [];
        this.currentChapterNum = 1;
        this.currentBranchId = mainBranch.id;
        this.currentStoryNotes = '';
        // Navigate to reader and generate chapter 1
        this._navigateToReader();
        this._updateReaderSidebar();
        await this._generateChapter(1, outline?.nodes?.[
            0
        ]?.id || 'node_1');
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
        this._allBranches = await this.storage.getBranches(novelId);
        // 找到主分支记录并用它的实际 id
        const mainBranch = this._allBranches?.find(b => b.forkChapter === 0 && b.parentBranchId === null);
        this.currentBranchId = mainBranch ? mainBranch.id : 'main';
        let chapters = await this.storage.getChaptersByBranch(novelId, this.currentBranchId);
        // 兼容旧数据：如果主分支没有章节但存在 'main' 标签的章节，迁移它们
        if (chapters.length === 0 && this.currentBranchId !== 'main') {
            const legacyChapters = await this.storage.getChaptersByBranch(novelId, 'main');
            if (legacyChapters.length > 0) {
                for (const ch of legacyChapters) {
                    const migrated = {
                        ...ch,
                        id: `${this.currentBranchId}_ch_${ch.chapterNumber}`,
                        branchId: this.currentBranchId
                    };
                    await this.storage.saveChapter(migrated);
                }
                chapters = await this.storage.getChaptersByBranch(novelId, this.currentBranchId);
            }
        }
        this.currentNovel = novel;
        this.currentBible = bible;
        this.currentOutline = outline;
        this.currentChapters = chapters;
        this.currentChapterNum = novel.lastReadChapter || 1;
        this.currentStoryNotes = this._loadStoryNotes(novelId, this.currentBranchId);
        this._navigateToReader();
        this._updateReaderSidebar();
        // Load the last read chapter
        const chapter = chapters.find(c => c.chapterNumber === this.currentChapterNum);
        if (chapter) {
            this.ui.showReader(novel, chapter);
            const isEnding = this.currentOutline?.nodes?.[this.currentChapterNum - 1]?.isEnding || false;
            this.ui.showReaderBottom(this.currentChapterNum, isEnding);
        } else {
            this.ui.showReader(novel, {
                chapterNumber: this.currentChapterNum
            });
            // Auto-generate if not exists
            const nodeId = outline?.nodes?.[this.currentChapterNum - 1]?.id;
            if (nodeId) {
                await this._generateChapter(this.currentChapterNum, nodeId);
            }
        }
    }
    _updateReaderSidebar() {
        this.ui.updateOutlineProgress(this.currentOutline, this.currentChapterNum, this.currentChapters);
        this.ui.updateCharacterList(this.currentBible);
        this.ui.updateWorldRules(this.currentBible);
        if (this._allBranches) {
            this.ui.updateBranchList(this._allBranches, this.currentNovel.id, this.currentBranchId);
        }
    }
    async _generateChapter(chapterNum, nodeId, branchPrompt = null) {
        if (this.isGenerating) return;
        this.isGenerating = true;
        // === CACHE CHECK ===
        if (this.currentNovel) {
            const chapters = await this.storage.getChaptersByBranch(this.currentNovel.id, this.currentBranchId);
            const existing = chapters.find(c => c.chapterNumber === chapterNum);
            if (existing && existing.content) {
                // Update local chapters array
                this.currentChapters = chapters;
                this.ui.showReader(this.currentNovel, existing);
                const isEnding = this.currentOutline?.nodes?.[
                    chapterNum - 1
                ]?.isEnding || false;
                this.ui.showReaderBottom(chapterNum, isEnding);
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
        const isEpilogue = nodeId && nodeId.startsWith('epilogue_');
        let chapterTitle;
        if (isEpilogue) {
            const epilogueNum = nodeId.split('_')[1] || '1';
            chapterTitle = `后日谈 · 第${epilogueNum}章`;
        } else {
            chapterTitle = this.currentOutline?.nodes?.find(n => n.id === nodeId)?.title || `第 ${chapterNum} 章`;
        }
        document.getElementById('reader-chapter-num').textContent = isEpilogue ? chapterTitle : `第 ${chapterNum} 章`;
        document.getElementById('chapter-title').textContent = chapterTitle;
        document.getElementById('chapter-body').innerHTML = '<p class="text-muted">AI 正在构思...</p>';
        document.getElementById('reader-choices').innerHTML = '';
        this.ui.showTypingIndicator(true);
        this._updateReaderSidebar();
        try {
            const result = await this.engine.generateChapter(this.currentBible, this.currentOutline, this.currentNovel, chapterNum, nodeId, previousSummary, previousChapterFull,
                (token, full) => {
                    // Remove "preparing" text on first token
                    this.ui.appendChapterToken(token);
                }, branchPrompt, this.currentStoryNotes || '');
            this.ui.showTypingIndicator(false);
            // 用纯净内容（去除 ---NOTES---）重新渲染阅读区
            document.getElementById('chapter-body').innerHTML = this.ui._formatChapterContent(result.content);
            // Build chapter object
            const chapter = {
                id: `${this.currentNovel.id}_${this.currentBranchId}_ch_${chapterNum}`,
                novelId: this.currentNovel.id,
                branchId: this.currentBranchId,
                chapterNumber: chapterNum,
                title: chapterTitle,
                content: result.content,
                summary: '',
                isEpilogue: isEpilogueNode || false,
                epilogueNum: isEpilogueNode ? this.epilogueCount : undefined
            };
            await this.storage.saveChapter(chapter);
            // Update local chapters
            const existingIdx = this.currentChapters.findIndex(c => c.chapterNumber === chapterNum);
            if (existingIdx >= 0) {
                this.currentChapters[existingIdx] = chapter;
            } else {
                this.currentChapters.push(chapter);
                this.currentChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
            }
            // Update novel progress
            this.currentNovel.lastReadChapter = chapterNum;
            this.currentNovel.totalChapters = Math.max(this.currentNovel.totalChapters || 0, this.currentOutline?.nodes?.length || chapterNum);
            await this.storage.saveNovel(this.currentNovel);
            // Parse and save story notes
            if (result.notes) {
                const newNotes = result.notes;
                this.currentStoryNotes = this.currentStoryNotes ? this.currentStoryNotes + '\n\n---\n\n' + newNotes : newNotes;
                this._saveStoryNotes(this.currentNovel.id, this.currentBranchId, this.currentStoryNotes);
            }
            // 累计 token 用量
            const tokensThisChapter = result.usage?.total_tokens || Math.ceil(result.content.length / 2.5);
            if (tokensThisChapter > 0) {
                const key = 'nightread_tokens_' + this.currentNovel.id + '_' + this.currentBranchId;
                const prev = parseInt(localStorage.getItem(key) || '0');
                localStorage.setItem(key, String(prev + tokensThisChapter));


            }
            // Update UI
            document.getElementById('chapter-title').textContent = chapterTitle;
            const isEpilogueNode = nodeId && nodeId.startsWith('epilogue_');
            const genNode = isEpilogueNode
                ? { isEnding: false }
                : (this.currentOutline?.nodes?.find(n => n.id === nodeId) || null);
            const isEnding = genNode?.isEnding || false;
            this.ui.showReaderBottom(chapterNum, isEnding);
            this._updateReaderSidebar();
            // Handle ending
            if (isEnding) {
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
    async _onReaderBottomClick(e) {
        if (this.isGenerating) return;
        // Handle epilogue button
        const epilogueBtn = e.target.closest('.btn-epilogue');
        if (epilogueBtn) {
            this.epilogueCount++;
            const nodeId = `epilogue_${this.epilogueCount}`;
            this.currentChapterNum = (this.currentOutline?.nodes?.length || 0) + this.epilogueCount;
            await this._generateChapter(this.currentChapterNum, nodeId);
            return;
        }
        // Handle next chapter button
        const btn = e.target.closest('.next-chapter-btn');
        if (!btn) return;
        const nextNodeId = this.currentOutline?.nodes?.[this.currentChapterNum]?.id;
        if (!nextNodeId) {
            this.ui.toast('\u5927\u7eb2\u5df2\u5230\u5c3d\u5934', 'info');
            return;
        }
        this.currentChapterNum++;
        await this._generateChapter(this.currentChapterNum, nextNodeId);
    }
    async _onEditWorld() {
        if (!this.currentBible || !this.currentOutline) {
            this.ui.toast('没有可编辑的世界观数据', 'warning');
            return;
        }
        document.getElementById('world-editor-bible').textContent = JSON.stringify(this.currentBible, null, 2);
        document.getElementById('world-editor-outline').textContent = JSON.stringify(this.currentOutline, null, 2);
        document.getElementById('world-editor-overlay').classList.remove('hidden');
    }
    async _onWorldEditorSave() {
        try {
            const bibleText = document.getElementById('world-editor-bible').textContent.trim();
            const outlineText = document.getElementById('world-editor-outline').textContent.trim();
            if (!bibleText || !outlineText) {
                this.ui.toast('内容不能为空', 'warning');
                return;
            }
            const newBible = JSON.parse(bibleText);
            const newOutline = JSON.parse(outlineText);
            // Validate structure
            if (!newBible.worldSetting && !newBible.characters) {
                this.ui.toast('世界观设定缺少必要字段', 'warning');
                return;
            }
            if (!newOutline.nodes || !Array.isArray(newOutline.nodes)) {
                this.ui.toast('大纲缺少 nodes 数组', 'warning');
                return;
            }
            // Save to IndexedDB
            newBible.novelId = this.currentNovel.id;
            newOutline.novelId = this.currentNovel.id;
            await this.storage.saveBible(newBible);
            await this.storage.saveOutline(newOutline);
            // Update current references
            this.currentBible = newBible;
            this.currentOutline = newOutline;
            // Update sidebar
            this._updateReaderSidebar();
            this.ui.toast('世界观/大纲已更新 ✓', 'success');
            document.getElementById('world-editor-overlay').classList.add('hidden');
        } catch (e) {
            this.ui.toast(`保存失败: JSON 格式错误 - ${e.message}`, 'error');
        }
    }
    _onWorldEditorCancel() {
        document.getElementById('world-editor-overlay').classList.add('hidden');
    }
    _onSidebarContextMenu(e) {
        const nodeEl = e.target.closest('.outline-node.clickable');
        if (!nodeEl) return;
        e.preventDefault();
        const chapterNum = parseInt(nodeEl.dataset.chapter);
        if (!chapterNum || isNaN(chapterNum)) return;
        // Only show fork menu on chapters that have been generated
        const chapter = this.currentChapters.find(c => c.chapterNumber === chapterNum);
        if (!chapter || !chapter.content) return;
        this.ui.showBranchMenu(chapterNum, e.clientX, e.clientY);
    }
    async _onBranchSubmit(chapterNum) {
        try {
            const name = document.getElementById('branch-name-input')?.value?.trim() || '';
            const prompt = document.getElementById('branch-prompt-input')?.value?.trim();
            if (!prompt) {
                this.ui.toast('请输入分支提示词', 'warning');
                return;
            }
            const branchId = `${this.currentNovel.id}_branch_${Date.now()}`;
            // 从老分支继承 forkChapter 之前的所有章节
            const parentChapters = await this.storage.getChaptersByBranch(this.currentNovel.id, this.currentBranchId);
            const forkChapters = parentChapters.filter(c => c.chapterNumber <= chapterNum);
            for (const ch of forkChapters) {
                const newCh = {
                    ...ch,
                    id: `${branchId}_ch_${ch.chapterNumber}`,
                    branchId
                };
                await this.storage.saveChapter(newCh);
            }
            // 创建分支记录
            const branchName = name || prompt.slice(0, 20);
            const branch = {
                id: branchId,
                novelId: this.currentNovel.id,
                parentBranchId: this.currentBranchId,
                name: branchName,
                forkChapter: chapterNum,
                forkPrompt: prompt,
                createdAt: Date.now()
            };
            await this.storage.saveBranch(branch);
            // 立即刷新分支列表
            this._allBranches = await this.storage.getBranches(this.currentNovel.id);
            // Copy story notes from parent branch
            const parentNotes = this._loadStoryNotes(this.currentNovel.id, this.currentBranchId);
            this.currentStoryNotes = parentNotes || '';
            this._saveStoryNotes(this.currentNovel.id, branchId, this.currentStoryNotes);
            // 切换分支上下文
            this.currentBranchId = branchId;
            this.currentChapterNum = chapterNum;
            this.currentChapters = await this.storage.getChaptersByBranch(this.currentNovel.id, branchId);
            // 展示 forkChapter 并刷新侧栏（分支列表立即可见）
            const forkChapter = this.currentChapters.find(c => c.chapterNumber === chapterNum);
            if (forkChapter) {
                this.ui.showReader(this.currentNovel, forkChapter);
            }
            this._updateReaderSidebar();
            // 生成下一章
            const nextNodeId = this.currentOutline?.nodes?.[
                chapterNum
            ]?.id;
            if (nextNodeId) {
                await this._generateChapter(chapterNum + 1, nextNodeId, prompt);
            }
            // overlay already hidden above
            this.ui.toast(`已签出新分支「${prompt.slice(0, 20)}${prompt.length > 20 ? '...' : ''}」`, 'success');
        } catch (e) {
            console.error('Branch creation failed:', e);
            this.ui.toast(`签出失败: ${e.message}`, 'error');
        }
    }
    async _onBranchClick(e) {
        const item = e.target.closest('.branch-item');
        if (!item || item.classList.contains('current')) return;
        const branchId = item.dataset.branchId;
        if (!branchId || branchId === this.currentBranchId) return;
        // Switch branch
        this.currentBranchId = branchId;
        this.currentChapters = await this.storage.getChaptersByBranch(this.currentNovel.id, branchId);
        const lastCh = this.currentChapters[this.currentChapters.length - 1];
        if (lastCh) {
            this.currentChapterNum = lastCh.chapterNumber;
            this.ui.showReader(this.currentNovel, lastCh);
            const isEnding = this.currentOutline?.nodes?.[lastCh.chapterNumber - 1]?.isEnding || false;
            this.ui.showReaderBottom(lastCh.chapterNumber, isEnding);
        } else {
            // Branch has no chapters — go to fork point
            const branchMeta = this._allBranches?.find(b => b.id === branchId);
            this.currentChapterNum = branchMeta?.forkChapter || 1;
            this.ui.showReader(this.currentNovel, {
                chapterNumber: this.currentChapterNum
            });
        }
        this.currentStoryNotes = this._loadStoryNotes(this.currentNovel.id, branchId);
        this._updateReaderSidebar();
        this.ui.toast(`已切换到 ${branchId.endsWith('_main') ? '主分支' : '分支'}`, 'info');
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
                    id: n.id,
                    title: n.title,
                    summary: n.summary
                }))
            } : null,
            chapters: chapters.sort((a, b) => a.chapterNumber - b.chapterNumber).map(c => ({
                chapterNumber: c.chapterNumber,
                title: c.title,
                content: c.content,
                summary: c.summary
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
        const blob = new Blob([
            text
        ], {
            type: 'text/plain;charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // 文件名：书名-分支名.txt
        const branchMeta = this._allBranches?.find(b => b.id === this.currentBranchId);
        const branchSuffix = branchMeta && !branchMeta.id.endsWith('_main') ? '-' + (branchMeta.name || branchMeta.forkPrompt?.slice(0, 12)) : '';
        a.download = `${novel.title || '未命名'}${branchSuffix}.txt`;
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
        const isEnding = this.currentOutline?.nodes?.[chapterNum - 1]?.isEnding || false;
        this.ui.showReaderBottom(chapterNum, isEnding);
        this._updateReaderSidebar();
    }
    // --- Helpers ---
    _generateId() {
        return 'novel_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
    _handleResize() {
        if (this.currentView === 'reader' && window.innerWidth > 900) {
            document.getElementById('reader-sidebar').style.display = '';
            document.getElementById('sidebar-overlay').classList.add('hidden');
        }
    }
    _loadStoryNotes(novelId, branchId) {
        try {
            const key = 'nightread_notes_' + novelId + '_' + branchId;
            return localStorage.getItem(key) || '';
        } catch (e) {
            return '';
        }
    }
    _saveStoryNotes(novelId, branchId, notes) {
        try {
            const key = 'nightread_notes_' + novelId + '_' + branchId;
            localStorage.setItem(key, notes || '');
        } catch (e) {
            /* ignore */
        }
    }
}
// ==================== BOOTSTRAP ====================
window.addEventListener('error', (e) => {
    console.error('[NightRead GLOBAL]', e.error?.stack || e.message);
});
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init().catch(e => {
        console.error('App init failed:', e);
    });
});

