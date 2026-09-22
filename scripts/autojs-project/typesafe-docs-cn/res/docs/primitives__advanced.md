---
slug: primitives/advanced
group: primitives
order: 14
title: 高级：问题的结构
titleEn: Advanced: structure
url: https://docs.typesafe.ai/primitives/advanced
summary: instructions、Choice 选项、Score 等级、Noul criteria 都可接受 JSON 结构，何时以及如何结构化一个问题。
---

[System One](https://docs.typesafe.ai/concepts/system-one) 模型被训练成能理解结构。

## 哪里允许结构

下面这些字段每个都是一个 [`EntryType`](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/EntryType)。

| 字段 | 适用于 | 接受的形状 |
| --- | --- | --- |
| `instructions` | Choice、Score、Noul | `string`、`object`、`array` 或 `null` |
| `criteria` 值（选项描述） | Choice | `string`、`object`、`array` 或 `null` |
| `criteria` 条目（等级描述） | Score | `string`、`object`、`array` 或 `null` |
| `criteria.true` 与 `criteria.false` | Noul | `string`、`object`、`array` 或 `null` |

## 何时结构化一个问题

- undefined*当有助于清晰时。** 当一个问题有多部分，把它们写成 JSON 形式有助于清晰，因为键带标签。
- undefined*当问题需要支撑数据时。** 一个 schema、分类法、或数据库行本来就是 JSON。整个用 JSON，或只传入相关的子字段，而不是把它们序列化进字符串模板。

## 结构化的 instructions

一个 `field` 对象描述被检查的字段，每个问题通过键引用它。同样的形状驱动一个验证值的 Noul、一个从候选里选一个的 Choice，以及两个把值放到量表上的 Score。

```json
state: {
  source_text:
    'Invoice #4471 issued March 3, 2026 to Beaver Dam Logistics for $12,840.00, net 30.',
},
selectedModels: ['jev-latest'],
questions: {
  invoice_number_is_correct: {
    type: 'noul',
    instructions: {
      field: {
        name: 'invoice_number',
        type: 'string',
        description: 'The identifier printed on the invoice.',
      },
      extracted_value: '4471',
      question: 'Does `extracted_value` match the `field` as it appears in `source_text`?',
    },
  },
  customer_name: {
    type: 'choice',
    instructions: {
      field: {
        name: 'customer_name',
        type: 'string',
        description: 'The organization the invoice was issued to.',
      },
      question: 'Which option is the value of `field` in `source_text`?',
    },
    criteria: {
      'Beaver Logistics': null,
      'Dam Logistics': null,
      'Beaver Dam Logistics': null,
      'Beaver': null,
      'Dam': null,
    },
  },
  amount_due: {
    type: 'score',
    instructions: {
      field: {
        name: 'amount_due',
        type: 'number',
        unit: 'USD',
        description: 'The total the invoice asks to be paid.',
      },
      question: 'How large is the `field` value in `source_text`?',
    },
    criteria: [
      'Under $1,000',
      '$1,000 to $10,000',
      '$10,000 to $100,000',
      '$100,000 to $1,000,000',
      'Over $1,000,000',
    ],
  },
  payment_terms: {
    type: 'score',
    instructions: {
      field: {
        name: 'payment_terms',
        type: 'integer',
        unit: 'days',
        description: 'Days allowed for payment, from terms such as "net 30".',
      },
      question: 'How many days does the `field` in `source_text` allow for payment?',
    },
    criteria: [
      'Due on receipt',
      'Net 10',
      'Net 30',
      'Net 60',
      'Net 90',
    ],
  },
}
```

在代码里，你可以遍历潜在记录，为每个字段构造这些问题中的一个，全部放在单次调用里发送。 [SDE cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade) 做了类似的事。

数组也可以。当 instructions 是一组要检查或要对照的东西时用一个：

```json
"instructions": {
  "question": "Does the claimed sender identity conflict with the sending domain?",
  "compare": ["ticket.sender.display_name", "ticket.sender.email"],
  "focus": "Compare the named organization with the email domain."
}
```

## 结构化的 Choice 选项

一个 Choice 选项描述也可以是一个结构化对象。

### 用于边界澄清的 JSON 评分量表

```json
state: 'I ordered the standing desk two weeks ago and tracking still says label created. Was I even charged?',
selectedModels: ['jev-latest'],
questions: {
  department: {
    type: 'choice',
    instructions: {
      question: 'Which team should handle this message?',
      focus: "Classify the customer's primary request, not every topic mentioned.",
    },
    criteria: {
      billing: {
        what: 'Charges, invoices, refunds, or subscriptions',
        not_for: 'Order tracking or account access',
        examples: ['I was charged twice', 'Where is my refund?'],
      },
      orders: {
        what: 'Order status, delivery, cancellation, or returns',
        not_for: 'Charges or account access',
        examples: ['Where is my package?', 'Cancel my order'],
      },
      account: {
        what: 'Login, password, profile, or security',
        not_for: 'Charges or delivery',
        examples: ["I can't log in", 'Change my email'],
      },
    },
  },
}
```

这个例子告诉模型每个选项涵盖什么、不涵盖什么。它锐化了选项之间的边界。

### 走查一个分类法

要分类进一个深层分类法，每级问一个 Choice，在代码里走这棵树。每一步选项是当前节点的子节点，每个选项的值是该子节点的树。这样做能让模型在 commit 到一个分支前，先看到分支下有什么，当物品属于一个名字从分支名看不明显的叶子时这很重要。

这里 state 是一个产品列表，第一个问题选一个顶层部门。

```json
state: "32oz plastic bottle with a flip straw lid. Fits most bike cages.",
selectedModels: ['jev-latest'],
questions: {
  department: {
    type: 'choice',
    instructions: 'Which top-level department does this product belong to?',
    criteria: {
      'Sporting Goods': {
        Cycling: ['Bike Bottles & Cages', 'Bike Lights', 'Helmets'],
        Fitness: ['Yoga Mats', 'Resistance Bands'],
        Outdoor: ['Tents', 'Sleeping Bags', 'Hydration Packs'],
      },
      'Home & Kitchen': {
        Drinkware: ['Water Bottles', 'Travel Mugs', 'Tumblers'],
        Cookware: ['Pots & Pans', 'Bakeware'],
      },
      'Baby & Toddler': ['Sippy Cups', 'Bottle Warmers', 'Bibs'],
    },
  },
}
```

这个瓶子可能属于两个部门。展示子树让模型看到 `Sporting Goods > Cycling > Bike Bottles & Cages` 和 `Home & Kitchen > Drinkware > Water Bottles` 都存在，并权衡列表对自行车架的强调与日常饮具。这个答案的 `probabilities` 告诉你分裂是否足够接近、值得探索两个分支。

一旦选了部门，用该部门的子节点作为选项、其子树作为值，问下一个 Choice，重复直到到达叶子。在代码里这可以是对嵌套字典的一个循环，每个问题的 `criteria` 就是当前节点。 [Hierarchical Classification cookbook](https://docs.typesafe.ai/cookbooks/hierarchical_classification) 展示了类似的走树例子，包括当概率接近时用束搜索保留多条候选路径。

> **注意：** 子树可能变得很大。如果一个分支太大，把值裁到直接子节点加一部分叶子。

## 结构化的 Score 等级

Score `criteria` 数组里的每个条目可以是对象。

```json
state: 'Fixed the null check in the payment handler. Also refactored the retry loop while I was in there, and bumped the SDK version since the old one had that timeout bug.',
selectedModels: ['jev-latest'],
questions: {
  pr_scope: {
    type: 'score',
    instructions: {
      question: 'How focused is this pull request description on a single change?',
      note: 'Judge the number of independent changes, not the size of any one change.',
    },
    criteria: [
      { summary: 'One change, clearly stated', signals: ['A single fix or feature', 'Nothing described as "also" or "while I was in there"'] },
      { summary: 'One main change plus a small related tweak', signals: ['A primary change and one minor adjacent edit', 'The tweak supports the main change'] },
      { summary: 'Several independent changes bundled together', signals: ['Two or more unrelated fixes or features', 'Changes that could each be their own PR'] },
    ],
  },
}
```

## 结构化的 Noul criteria

Noul `criteria` 是可选的，当 yes/no 边界微妙时，结构化的 `true` 和 `false` 描述让你用定义加示例把边界钉死在每一侧。

```json
state: {
  sender: { display_name: 'Beaver Dam Builders Ltd.', email: 'donotreply@payroll.example' },
  message:
    'Your Q3 bonus is ready. Reply with your login password so we can verify your identity and release the funds.',
},
selectedModels: ['jev-latest'],
questions: {
  requests_credentials: {
    type: 'noul',
    instructions: {
      question: 'Does the `message` ask the recipient to disclose a sensitive credential?',
      inspect: 'message',
      focus: 'Look for a request to send the credential itself, not a request to change or reset it.',
    },
    criteria: {
      true: {
        what: 'Asks the recipient to reply with, type, or send a password, PIN, one-time code, or other security sensitive answer',
        examples: ['Reply with your password', 'Send us the 6-digit code you just received'],
      },
      false: {
        what: 'No sensitive credential is requested',
        examples: ['Reset your password from the settings page', 'Your statement is ready'],
      },
    },
  },
}
```
