/* 自动生成，勿手改 —— 源在 res/docs/*.md 的 frontmatter，由 tools/gen-pages.cjs（build-page.cjs 会自动调用）汇总。 */
window.DOC_FM={
 "introduction": {
  "slug": "introduction",
  "group": "intro",
  "order": 1,
  "title": "简介",
  "titleEn": "Introduction",
  "url": "https://docs.typesafe.ai/introduction",
  "summary": "Jev 是首个 System One 模型：给 state 与类型化问题，直接拿结构化答案。"
 },
 "introduction/quickstart": {
  "slug": "introduction/quickstart",
  "group": "intro",
  "order": 2,
  "title": "快速开始",
  "titleEn": "Quick start",
  "url": "https://docs.typesafe.ai/introduction/quickstart",
  "summary": "在 Playground、HTTP API 与 Python SDK 中几步跑通 Jev。"
 },
 "introduction/coding-agents": {
  "slug": "introduction/coding-agents",
  "group": "intro",
  "order": 3,
  "title": "与编码智能体协作",
  "titleEn": "Jev with coding agents",
  "url": "https://docs.typesafe.ai/introduction/coding-agents",
  "summary": "Jev 不是编码智能体的 LLM，而是你代码里做结构化决策的工具。"
 },
 "introduction/machine-learning-primer": {
  "slug": "introduction/machine-learning-primer",
  "group": "intro",
  "order": 4,
  "title": "AI 入门：为什么不用生成文本",
  "titleEn": "AI primer",
  "url": "https://docs.typesafe.ai/introduction/machine-learning-primer",
  "summary": "为什么 TypeSafe 训练校准决策模型，而非优化生成文本。"
 },
 "concepts/system-one": {
  "slug": "concepts/system-one",
  "group": "concepts",
  "order": 5,
  "title": "System One",
  "titleEn": "System One",
  "url": "https://docs.typesafe.ai/concepts/system-one",
  "summary": "TypeSafe 的旗舰模型 Jev 与第一个 System One 模型：给状态和类型化问题，直接拿结构化答案与概率。"
 },
 "concepts/state": {
  "slug": "concepts/state",
  "group": "concepts",
  "order": 6,
  "title": "State（状态）",
  "titleEn": "State",
  "url": "https://docs.typesafe.ai/concepts/state",
  "summary": "System One 模型要评估的内容：可以是字符串，也可以是结构化 JSON 对象或数组。"
 },
 "concepts/how-to-build-with-system-one": {
  "slug": "concepts/how-to-build-with-system-one",
  "group": "concepts",
  "order": 7,
  "title": "如何用 System One 构建",
  "titleEn": "How to build with TypeSafe",
  "url": "https://docs.typesafe.ai/concepts/how-to-build-with-system-one",
  "summary": "设计 AI 驱动的软件：让代码掌控控制流，只在需要常识判断处插入 System One 的狭窄结构化决策。"
 },
 "concepts/use-case-map": {
  "slug": "concepts/use-case-map",
  "group": "concepts",
  "order": 8,
  "title": "用例地图",
  "titleEn": "Example use cases",
  "url": "https://docs.typesafe.ai/concepts/use-case-map",
  "summary": "按行业与决策形态浏览 TypeSafe 的落地场景：从搜索检索到金融犯罪、从分类到验证。"
 },
 "models": {
  "slug": "models",
  "group": "concepts",
  "order": 9,
  "title": "模型",
  "titleEn": "Models",
  "url": "https://docs.typesafe.ai/models",
  "summary": "Jev 系列模型：当前模型 jev-1.13.0 的价格、速率限制、上下文长度与别名，以及如何列出模型。"
 },
 "primitives": {
  "slug": "primitives",
  "group": "primitives",
  "order": 10,
  "title": "原语（问题）总览",
  "titleEn": "Primitives (Questions)",
  "url": "https://docs.typesafe.ai/primitives",
  "summary": "三种 AI 原语 Choice / Score / Noul，各自的答案结构，以及如何一次问多个问题。"
 },
 "primitives/choice": {
  "slug": "primitives/choice",
  "group": "primitives",
  "order": 11,
  "title": "Choice（选择）",
  "titleEn": "Choice",
  "url": "https://docs.typesafe.ai/primitives/choice",
  "summary": "从一组固定选项中选一个的 System One 问题类型，返回选中项、各选项概率与置信度。"
 },
 "primitives/score": {
  "slug": "primitives/score",
  "group": "primitives",
  "order": 12,
  "title": "Score（评分）",
  "titleEn": "Score",
  "url": "https://docs.typesafe.ai/primitives/score",
  "summary": "针对有序、可描述的等级为内容打分的 System One 问题类型，返回分数、各等级概率与置信度。"
 },
 "primitives/noul": {
  "slug": "primitives/noul",
  "group": "primitives",
  "order": 13,
  "title": "Noul（判断）",
  "titleEn": "Noul",
  "url": "https://docs.typesafe.ai/primitives/noul",
  "summary": "让 TypeSafe 模型评估一个 yes/no 问题、返回答案为 yes 的概率的 System One 问题类型。"
 },
 "primitives/advanced": {
  "slug": "primitives/advanced",
  "group": "primitives",
  "order": 14,
  "title": "高级：问题的结构",
  "titleEn": "Advanced: structure",
  "url": "https://docs.typesafe.ai/primitives/advanced",
  "summary": "instructions、Choice 选项、Score 等级、Noul criteria 都可接受 JSON 结构，何时以及如何结构化一个问题。"
 },
 "confidence": {
  "slug": "confidence",
  "group": "patterns",
  "order": 15,
  "title": "置信度",
  "titleEn": "Confidence",
  "url": "https://docs.typesafe.ai/confidence",
  "summary": "TypeSafe 如何报告确定性、它与概率的区别，以及用它来控制系统行为。"
 },
 "patterns": {
  "slug": "patterns",
  "group": "patterns",
  "order": 16,
  "title": "模式总览",
  "titleEn": "Patterns",
  "url": "https://docs.typesafe.ai/patterns",
  "summary": "用 TypeSafe 原语构建系统的架构模式总览。"
 },
 "patterns/fan-out": {
  "slug": "patterns/fan-out",
  "group": "patterns",
  "order": 17,
  "title": "推测式扇出",
  "titleEn": "Speculative fan-out",
  "url": "https://docs.typesafe.ai/patterns/fan-out",
  "summary": "在一次调用中发送多个（含推测性）问题，由代码决定相关性的扇出模式。"
 },
 "patterns/confidence-routing": {
  "slug": "patterns/confidence-routing",
  "group": "patterns",
  "order": 18,
  "title": "置信度门控路由",
  "titleEn": "Confidence-gated routing",
  "url": "https://docs.typesafe.ai/patterns/confidence-routing",
  "summary": "把 confidence 作为第二决策轴，按确定程度决定系统行为的路由模式。"
 },
 "patterns/composite-scoring": {
  "slug": "patterns/composite-scoring",
  "group": "patterns",
  "order": 19,
  "title": "复合评分",
  "titleEn": "Composite scoring",
  "url": "https://docs.typesafe.ai/patterns/composite-scoring",
  "summary": "把复杂判断拆成原子分数，再用代码中可控的权重合并成单一评分。"
 },
 "patterns/intent-routing": {
  "slug": "patterns/intent-routing",
  "group": "patterns",
  "order": 20,
  "title": "意图路由",
  "titleEn": "Intent routing",
  "url": "https://docs.typesafe.ai/patterns/intent-routing",
  "summary": "对请求分类，并路由到最优处理程序：确定性逻辑、专用 LLM 或人工。"
 },
 "cookbooks/consistency_noul_cookbook": {
  "slug": "cookbooks/consistency_noul_cookbook",
  "group": "cookbook",
  "order": 21,
  "title": "自洽性：Noul 多次判定取一致",
  "titleEn": "Self-consistency: nouls",
  "url": "https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook",
  "summary": "对一份车险理赔单重复跑 14 道 Noul 题，比较各模型自洽性与不确定决策。"
 },
 "cookbooks/consistency_choice_cookbook": {
  "slug": "cookbooks/consistency_choice_cookbook",
  "group": "cookbook",
  "order": 22,
  "title": "自洽性：Choice 多次选择取一致",
  "titleEn": "Self-consistency: choices",
  "url": "https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook",
  "summary": "对用户帖重复跑 8 道 Choice 题，比较标签自洽性并引入不确定转人工。"
 },
 "cookbooks/parallel_questions": {
  "slug": "cookbooks/parallel_questions",
  "group": "cookbook",
  "order": 23,
  "title": "并行提问",
  "titleEn": "Parallel questions",
  "url": "https://docs.typesafe.ai/cookbooks/parallel_questions",
  "summary": "把 13 个问题并成一次 TypeSafe 调用：成本降 12.2x、提速 10.0x，答案不变。"
 },
 "cookbooks/rerank_typesafe": {
  "slug": "cookbooks/rerank_typesafe",
  "group": "cookbook",
  "order": 24,
  "title": "重排序",
  "titleEn": "Re-ranking",
  "url": "https://docs.typesafe.ai/cookbooks/rerank_typesafe",
  "summary": "用 BM25 短列表 + 每对一次 TypeSafe 问题，把 top-1 准确率从 5% 提到 18%。"
 },
 "cookbooks/semantic_find": {
  "slug": "cookbooks/semantic_find",
  "group": "cookbook",
  "order": 25,
  "title": "逐行语义检索",
  "titleEn": "Line-by-line search",
  "url": "https://docs.typesafe.ai/cookbooks/semantic_find",
  "summary": "一次请求内对 218 行做语义检索：Choice 排序、Noul 判存在。"
 },
 "cookbooks/autoformat": {
  "slug": "cookbooks/autoformat",
  "group": "cookbook",
  "order": 26,
  "title": "结构还原",
  "titleEn": "Structure recovery",
  "url": "https://docs.typesafe.ai/cookbooks/autoformat",
  "summary": "两次请求把丢失格式的纯文本还原为 Markdown 结构与标记。"
 },
 "cookbooks/function_calling": {
  "slug": "cookbooks/function_calling",
  "group": "cookbook",
  "order": 27,
  "title": "函数调用",
  "titleEn": "Function calling",
  "url": "https://docs.typesafe.ai/cookbooks/function_calling",
  "summary": "把自然语言交易请求变成带 confidence 的类型化函数调用。"
 },
 "cookbooks/skill_suggestion": {
  "slug": "cookbooks/skill_suggestion",
  "group": "cookbook",
  "order": 28,
  "title": "skill 建议",
  "titleEn": "Skill suggestion",
  "url": "https://docs.typesafe.ai/cookbooks/skill_suggestion",
  "summary": "为一次 turn 从 182 个 skill 里最多挑出一个。"
 },
 "cookbooks/entity_alignment": {
  "slug": "cookbooks/entity_alignment",
  "group": "cookbook",
  "order": 29,
  "title": "知识图谱实体对齐",
  "titleEn": "Knowledge graph entity alignment",
  "url": "https://docs.typesafe.ai/cookbooks/entity_alignment",
  "summary": "用一道 Score 问题在 450 对候选里判断哪些啤酒记录是同一个产品。"
 },
 "cookbooks/classifying_rag_passages": {
  "slug": "cookbooks/classifying_rag_passages",
  "group": "cookbook",
  "order": 30,
  "title": "给 RAG 检索段落分类",
  "titleEn": "Classifying RAG passages",
  "url": "https://docs.typesafe.ai/cookbooks/classifying_rag_passages",
  "summary": "用一次 TypeSafe 请求给每个检索段落打分，再由代码决定其去留。"
 },
 "cookbooks/citation_check": {
  "slug": "cookbooks/citation_check",
  "group": "cookbook",
  "order": 31,
  "title": "复核引用是否站得住",
  "titleEn": "Double-checking citations",
  "url": "https://docs.typesafe.ai/cookbooks/citation_check",
  "summary": "用一道 Choice 判断引文上下文是否支持论断，低置信度转人工。"
 },
 "cookbooks/llm_guardrails": {
  "slug": "cookbooks/llm_guardrails",
  "group": "cookbook",
  "order": 32,
  "title": "给 LLM 加护栏",
  "titleEn": "Guardrails for LLMs",
  "url": "https://docs.typesafe.ai/cookbooks/llm_guardrails",
  "summary": "用一次 TypeSafe 请求筛查进出 LLM 的消息，按阈值决定放行或拦截。"
 },
 "cookbooks/sde_cascade": {
  "slug": "cookbooks/sde_cascade",
  "group": "cookbook",
  "order": 33,
  "title": "SDE 级联",
  "titleEn": "SDE cascade",
  "url": "https://docs.typesafe.ai/cookbooks/sde_cascade",
  "summary": "两阶段抽取级联：小模型抽取，TypeSafe 逐字段校验，必要时升级到推理模型。"
 },
 "cookbooks/date_extraction_cookbook": {
  "slug": "cookbooks/date_extraction_cookbook",
  "group": "cookbook",
  "order": 34,
  "title": "日期抽取",
  "titleEn": "Date extraction",
  "url": "https://docs.typesafe.ai/cookbooks/date_extraction_cookbook",
  "summary": "用 Choice 读出日期的部件，再由代码解析成 date 并做低置信复核。"
 },
 "cookbooks/pre_parsed_value_extraction_cookbook": {
  "slug": "cookbooks/pre_parsed_value_extraction_cookbook",
  "group": "cookbook",
  "order": 35,
  "title": "预解析值抽取",
  "titleEn": "Pre-parsed value extraction",
  "url": "https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook",
  "summary": "正则找出候选值，TypeSafe 挑出目标 span，代码原样复制并归一化。"
 },
 "cookbooks/hierarchical_classification": {
  "slug": "cookbooks/hierarchical_classification",
  "group": "cookbook",
  "order": 36,
  "title": "层级分类",
  "titleEn": "Hierarchical classification",
  "url": "https://docs.typesafe.ai/cookbooks/hierarchical_classification",
  "summary": "用并行束搜索沿 TypeSafe Choice 的概率遍历深层层级，把文档分类到正确的叶节点。"
 },
 "cookbooks/autoresearch_feature_discovery": {
  "slug": "cookbooks/autoresearch_feature_discovery",
  "group": "cookbook",
  "order": 37,
  "title": "自动研究式特征发现",
  "titleEn": "Autoresearch feature discovery",
  "url": "https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery",
  "summary": "用自动研究循环提出 TypeSafe 问题，把自由文本变成数值特征，再用模型误差反向改进有监督的 CatBoost 回归器。"
 },
 "cookbooks/classification_using_confidence": {
  "slug": "cookbooks/classification_using_confidence",
  "group": "cookbook",
  "order": 38,
  "title": "用 confidence 做分类",
  "titleEn": "Classification using confidence",
  "url": "https://docs.typesafe.ai/cookbooks/classification_using_confidence",
  "summary": "每份文件一道 Choice 把 SEC 年报分到 75 个行业组，再用答案自身的 confidence 决定报这个组还是退到上一层分部。"
 },
 "sdk": {
  "slug": "sdk",
  "group": "sdk",
  "order": 39,
  "title": "客户端 SDK",
  "titleEn": "Client SDKs",
  "url": "https://docs.typesafe.ai/sdk",
  "summary": "安装 TypeSafe 客户端 SDK，在应用里用类型化的问题与答案。"
 },
 "sdk/python": {
  "slug": "sdk/python",
  "group": "sdk",
  "order": 40,
  "title": "TypeSafe Python SDK",
  "titleEn": "TypeSafe Python SDK",
  "url": "https://docs.typesafe.ai/sdk/python",
  "summary": "安装 TypeSafe Python SDK，开始使用异步或同步 API 调用。"
 },
 "sdk/javascript": {
  "slug": "sdk/javascript",
  "group": "sdk",
  "order": 41,
  "title": "JavaScript SDK",
  "titleEn": "JavaScript SDK",
  "url": "https://docs.typesafe.ai/sdk/javascript",
  "summary": "安装 JavaScript / TypeScript SDK，发出第一次类型化请求，答案类型自动推断。"
 },
 "api": {
  "slug": "api",
  "group": "sdk",
  "order": 42,
  "title": "API 参考",
  "titleEn": "API reference",
  "url": "https://docs.typesafe.ai/api",
  "summary": "TypeSafe 评估端点的完整 HTTP API 参考：请求体、三类问题、响应体与错误码。"
 },
 "demos": {
  "slug": "demos",
  "group": "sdk",
  "order": 43,
  "title": "演示",
  "titleEn": "Demos",
  "url": "https://docs.typesafe.ai/demos",
  "summary": "交互式示例，展示用 TypeSafe 能做到什么。"
 },
 "demos/smart-home": {
  "slug": "demos/smart-home",
  "group": "sdk",
  "order": 44,
  "title": "智能家居助手演示",
  "titleEn": "Smart home assistant demo",
  "url": "https://docs.typesafe.ai/demos/smart-home",
  "summary": "演示代码：一个用 TypeSafe 评估用户请求的智能家居助手。"
 },
 "agent-skill": {
  "slug": "agent-skill",
  "group": "sdk",
  "order": 45,
  "title": "智能体 skill",
  "titleEn": "Agent skill",
  "url": "https://docs.typesafe.ai/agent-skill",
  "summary": "给 Claude Code、Codex 等智能体环境的即插即用 skill，让编码智能体获得完整的 TypeSafe 上下文。"
 },
 "legal": {
  "slug": "legal",
  "group": "sdk",
  "order": 46,
  "title": "法律条款",
  "titleEn": "Legal",
  "url": "https://docs.typesafe.ai/legal",
  "summary": "TypeSafe 的法律文档与政策：数据处理、主客户协议与隐私政策。"
 }
};
/* 兼容位：既有工具与自检读的是 DOC_META.pages，指向同一份目录 */
(window.DOC_META=window.DOC_META||{}).pages=window.DOC_FM;
