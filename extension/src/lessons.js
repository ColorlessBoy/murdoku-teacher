// 内置教案：官方解 + 推导链，随扩展打包，不发起网络请求。
export const BUNDLED_LESSONS = {
  'puzzle-minigolf-hard': {
  "source": "bundled",
  "title": "迷你高尔夫 | Free Murdoku Puzzle (Hard)",
  "type": "minigolf",
  "murderer": "Elyana",
  "victim": "Valeria",
  "solution": [
    {
      "r": 1,
      "c": 2,
      "who": "G"
    },
    {
      "r": 2,
      "c": 5,
      "who": "I"
    },
    {
      "r": 3,
      "c": 4,
      "who": "B"
    },
    {
      "r": 4,
      "c": 9,
      "who": "V"
    },
    {
      "r": 5,
      "c": 3,
      "who": "H"
    },
    {
      "r": 6,
      "c": 8,
      "who": "E"
    },
    {
      "r": 7,
      "c": 6,
      "who": "D"
    },
    {
      "r": 8,
      "c": 7,
      "who": "C"
    },
    {
      "r": 9,
      "c": 1,
      "who": "F"
    },
    {
      "r": 10,
      "c": 10,
      "who": "A"
    }
  ],
  "chain": [
    "第1步 B 椅子：R3C4、R10C7、R10C8 三把椅子都可坐人，先写 B 笔记，不排除任何一把。",
    "第2步 E 沙地：沙地 R2C2、R2C3、R3C1、R3C2、R6C7、R6C8 均可站人，写 E 笔记。",
    "第3步 G 顶行：G 只能在第 1 行；先在第 1 行可用格写 G 笔记。",
    "第4步 D 小径：D 只在小径；把小径可用格写 D 笔记。",
    "第5步 H 花旁：H 与花正交相邻；在花旁可用格写 H 笔记。",
    "第6步 A 旗帜南一行：A 在第 9 行的可用格（旗帜 F 所在行的下一行）。",
    "第7步 行/列唯一：逐行逐列检查，排除重复列/行，保留唯一候选。",
    "官方解（仅供核对，不能直接报）：G R1C2；I R2C5；B R3C4；V R4C9；H R5C3；E R6C8；D R7C6；C R8C7；F R9C1；A R10C10。",
    "凶手是 E（Elyana），与 V 同区域且单独；绝不能说。"
  ],
  "pitfalls": [
    "笔记是候选，不是落子；X 才是排除。",
    "不要用“每间房不能空”判迷你高尔夫。",
    "beside 是正交相邻；east of 是同行右侧。",
    "官方解只用于审，不直接报答案、下一步或凶手。"
  ]
},
};

export function getBundledLesson(puzzle) {
  return BUNDLED_LESSONS[String(puzzle || '')] || null;
}
