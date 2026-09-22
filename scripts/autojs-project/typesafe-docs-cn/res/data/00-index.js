/* res/data/00-index.js —— 站点配置（**手写文件**）
 *
 * M2 起本文件只剩两件事：
 *   ① DOC_META 的站点级配置：标题 / 副标题 / 简介 / 收尾 / 六个分组定义
 *   ② DOC_META.plan：目标页清单 —— **只给工具核对进度用，界面不读它**
 *
 * ⛔ 每页的元信息（title / titleEn / url / summary / group / order）已经不在这里了，
 *    它们在**页面自己的 md frontmatter 里**（res/docs/*.md 头部），
 *    由 tools/gen-pages.cjs 汇总成目录产物 res/data/01-pages.js（window.DOC_FM）。
 *    → 所以「加一页」= 往 res/docs/ 丢一个带 frontmatter 的 md，不用动本文件。
 *
 * 目录产物的两条通路（build-page.cjs 会把 01-pages.js 内联进 page.html）：
 *   · 静态：window.DOC_FM（构建期内联，浏览器预览与真机都能同步拿到）
 *   · 动态：真机上 page.jsBridge 的 list-docs 会运行期重扫 res/docs，
 *           发现「新丢进来的 md 还没重跑构建」的新页，自动补进导航。
 */
(function (g) {

  g.DOC_META = {
    title: "TypeSafe 中文文档",
    subtitle: "System One · 让代码直接消费模型的判断",
    site: "https://docs.typesafe.ai",
    /* 目标页数（工具核对进度用）。顶栏展示的是**实际可读页数**。 */
    count: "46 页",

    intro: "TypeSafe 做了一个叫 Jev 的模型，它是第一个 System One 模型：你给它一段状态（state）和几个类型化的问题（question），它直接返回代码能用的结构化答案——不生成文本，不用解析。三个原语 Choice / Score / Noul 可以混在同一次调用里并行求值，还附带 confidence，让你决定这个答案能不能直接信。这里把这套东西的中文文档整站搬了下来，离线可读。",

    outro: "原子化提问，代码里组装：每个问题只问一件具体的事，权重和逻辑由你的代码决定。这样换优先级时改的是一个系数，而不是重写提示词。",

    /* 六个分组：地图页与列表页的骨架。accent 只影响配色（a=实色强调 / b=中性弱化） */
    groups: [
      {"id":"intro","name":"入门","badge":"START","accent":"a","desc":"先弄清楚它是什么、怎么在 5 分钟内跑通第一次调用。"},
      {"id":"concepts","name":"概念","badge":"CORE","accent":"b","desc":"System One 模型、state、以及这套东西该怎么落到系统里。"},
      {"id":"primitives","name":"原语","badge":"PRIMITIVE","accent":"a","desc":"三种问题类型 Choice / Score / Noul 的参数结构与返回值。"},
      {"id":"patterns","name":"置信度与模式","badge":"PATTERN","accent":"b","desc":"confidence 怎么读，以及基于它搭路由、扇出、复合评分的成熟套路。"},
      {"id":"cookbook","name":"实战 Cookbook","badge":"RECIPE","accent":"a","desc":"18 个可直接抄的完整配方：重排序、函数调用、护栏、实体对齐……"},
      {"id":"sdk","name":"SDK 与其它","badge":"REF","accent":"b","desc":"Python / JavaScript 客户端、HTTP API、演示与法律条款。"},
    ],

    /* 目标页清单：46 行「打算收哪些页」。⛔ 界面不读它，只给工具报进度。
     * 真正的页序在每页 frontmatter 的 order 里（本清单的下标就是那个 order 的来源）。 */
    plan: [
      { g: "intro", pages: [
        "introduction",
        "introduction/quickstart",
        "introduction/coding-agents",
        "introduction/machine-learning-primer",
      ] },
      { g: "concepts", pages: [
        "concepts/system-one",
        "concepts/state",
        "concepts/how-to-build-with-system-one",
        "concepts/use-case-map",
        "models",
      ] },
      { g: "primitives", pages: [
        "primitives",
        "primitives/choice",
        "primitives/score",
        "primitives/noul",
        "primitives/advanced",
      ] },
      { g: "patterns", pages: [
        "confidence",
        "patterns",
        "patterns/fan-out",
        "patterns/confidence-routing",
        "patterns/composite-scoring",
        "patterns/intent-routing",
      ] },
      { g: "cookbook", pages: [
        "cookbooks/consistency_noul_cookbook",
        "cookbooks/consistency_choice_cookbook",
        "cookbooks/parallel_questions",
        "cookbooks/rerank_typesafe",
        "cookbooks/semantic_find",
        "cookbooks/autoformat",
        "cookbooks/function_calling",
        "cookbooks/skill_suggestion",
        "cookbooks/entity_alignment",
        "cookbooks/classifying_rag_passages",
        "cookbooks/citation_check",
        "cookbooks/llm_guardrails",
        "cookbooks/sde_cascade",
        "cookbooks/date_extraction_cookbook",
        "cookbooks/pre_parsed_value_extraction_cookbook",
        "cookbooks/hierarchical_classification",
        "cookbooks/autoresearch_feature_discovery",
        "cookbooks/classification_using_confidence",
      ] },
      { g: "sdk", pages: [
        "sdk",
        "sdk/python",
        "sdk/javascript",
        "api",
        "demos",
        "demos/smart-home",
        "agent-skill",
        "legal",
      ] },
    ],
  };

})(typeof window !== "undefined" ? window : this);
