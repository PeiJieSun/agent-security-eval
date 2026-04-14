export type InjectionStyle = "naive" | "camouflaged" | "authority" | "encoded" | "chinese_obfuscated";

export const INJECTION_STYLE_META: Record<
  InjectionStyle,
  { label: string; color: string; bgColor: string; desc: string }
> = {
  naive: {
    label: "基础 [SYSTEM]",
    color: "text-gray-600",
    bgColor: "bg-gray-100",
    desc: "明文 [SYSTEM]: 前缀，现代 LLM 几乎100%识别并拒绝；仅作基线",
  },
  camouflaged: {
    label: "伪装转发链",
    color: "text-blue-700",
    bgColor: "bg-blue-100",
    desc: "注入嵌入转发邮件线程，无特殊标记，规避关键词过滤",
  },
  authority: {
    label: "IT 权威伪造",
    color: "text-amber-700",
    bgColor: "bg-amber-100",
    desc: "以 IT 安全部门名义发出合规指令，利用权威心理",
  },
  encoded: {
    label: "Unicode 编码",
    color: "text-purple-700",
    bgColor: "bg-purple-100",
    desc: "零宽字符混淆 payload，对人类不可见但 LLM tokenizer 可解读",
  },
  chinese_obfuscated: {
    label: "中文混淆",
    color: "text-red-700",
    bgColor: "bg-red-100",
    desc: "全角字符、中英混写、谐音绕过（法送=发送）、中文权威短语",
  },
};

export function getStyleMeta(style: InjectionStyle | undefined) {
  if (!style) return INJECTION_STYLE_META.naive;
  return INJECTION_STYLE_META[style] ?? INJECTION_STYLE_META.naive;
}
