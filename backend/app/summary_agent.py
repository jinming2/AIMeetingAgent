import os
import logging
import openai
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END
import json
from openai import OpenAI

# 配置 logger，确保 DEBUG 级别消息会输出
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
# 为 logger 添加一个控制台 handler
handler = logging.StreamHandler()
handler.setLevel(logging.DEBUG)
formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
handler.setFormatter(formatter)
if not logger.hasHandlers():
    logger.addHandler(handler)

# 初始化 OpenAI API Key
openai.api_key = os.getenv("OPENAI_API_KEY")
if not openai.api_key:
    logger.error("Missing OPENAI_API_KEY environment variable")


client = OpenAI()


# 状态类型定义
class MeetingState(TypedDict):
    transcript: str
    structured: Optional[str]
    memory: str  # 累计的会议历史内容


def segment_blocks(state: MeetingState) -> dict:
    """
    将本次 transcript 追加到 memory。
    """
    prev_memory = state.get("memory", "")
    text = state.get("transcript", "").strip()
    # logger.info(
    #     f"[segment_blocks] received transcript={text!r}, prev_memory={prev_memory!r}"
    # )
    if text and text not in prev_memory.split("\n"):
        updated_memory = f"{prev_memory}\n{text}" if prev_memory else text
    else:
        updated_memory = prev_memory
    # logger.info(f"[segment_blocks] updated_memory={updated_memory!r}")
    return {"transcript": text, "memory": updated_memory}


def generate_once_structured_outline(text: str) -> dict:
    """
    基于完整文本，直接生成一个新的结构化会议总结（不考虑历史，不叠加）
    """
    prompt = f"""
        你是一个会议总结助手，请根据下面这段完整的会议文字，生成结构化的会议大纲总结。

        要求：
        - 根据内容合理分成章节，每章起一个简明的标题，并用简洁语言总结该部分核心内容。
        - 标题使用编号（如 "1", "1.1", "2", "2.1" 等），层级合理。
        - 不要遗漏重要讨论点。
        - 只基于提供的这段文字总结，不需要参考历史记录。
        - 遇到模糊或跳跃内容时，合理推断并归纳整理。

        输出格式：
        - 返回一个 JSON 数组，数组中每个元素是一个对象，包含字段：
            - id（章节编号）
            - title（章节标题）
            - content（章节内容）

        示例格式：
        [
        {{
            "id": "1",
            "title": "Introduction",
            "content": "Summary of the introduction."
        }},
        {{
            "id": "2",
            "title": "Main Discussion",
            "content": "Summary of main discussion points."
        }}
        ]

        下面是会议内容：
        -----------------------
        {text}
        """

    schema = {
        "type": "json_schema",
        "json_schema": {
            "name": "initial_meeting_summary",
            "strict": True,
            "schema": {
                "type": "object",
                "additionalProperties": False,  # 🔥 这里加了！
                "required": ["summary"],
                "properties": {
                    "summary": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,  # 🔥 每一项也加了！
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                                "content": {"type": "string"},
                            },
                            "required": ["id", "title", "content"],
                        },
                    }
                },
            },
        },
    }

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            response_format=schema,
        )

        raw_json_content = response.choices[0].message.content

        try:
            structured_list = json.loads(raw_json_content)
            logger.info(
                "[generate_initial_structured_outline] Structured JSON:\n"
                + json.dumps(structured_list, indent=2, ensure_ascii=False)
            )
        except json.JSONDecodeError as e:
            logger.error(
                f"[generate_initial_structured_outline] JSON parsing failed: {e}"
            )
            structured_list = []  # fallback

        return {"structured": json.dumps(structured_list, ensure_ascii=False)}

    except Exception as e:
        logger.exception(
            "[generate_initial_structured_outline] OpenAI API call failed."
        )
        return {"structured": "[]"}  # fallback


def generate_structured_outline(state: MeetingState) -> dict:
    """
    基于 memory 和 existing structured summary，调用 OpenAI 生成多级结构化总结（标准JSON版）
    """
    memory = state.get("memory", "").strip()
    previous_structured = state.get("structured", None)

    previous_summary_text = previous_structured.strip() if previous_structured else "[]"
    logger.info("Memory " + memory + "\n")
    logger.info("previous_summary" + previous_summary_text + "\n")
    n = 5
    prompt = f"""
        你是一个会议总结助手，请基于已有的结构化摘要，结合本次新增会议内容，更新会议大纲。

        注意要求：
        - 对于已有小节（如标题、内容），如果没有非常重要的新变化，不要随意改动。
        - 仅当新的会议内容中出现重要新增信息时，才新增或修改对应小节。
        - 新增内容时，只关注最近新增的{n}条发言，忽略过往重复或无关信息。
        - 如果新的会议内容无新增重要信息，可以不做任何修改。
        - 新增的小节请合理插入到合适的位置，保持编号（如1, 1.1, 2, 2.1等）的逻辑顺序。
        - 所有小节应确保内容相关性清晰，避免出现主题跳跃或无关堆砌。
        - 根据输入语言判断选择相同语言输出

        格式要求：
        - 仅返回符合以下格式的 JSON 数组，无需额外文字说明。
        - 每个小节是一个对象，包含字段：
        - id（如 \"1\", \"1.1\"）
        - title（小节标题，简洁准确）
        - content（小节内容，概括核心信息）

        遵循以下结构格式：
                {{
                    "summary": [
                        {{
                            "id": "1",
                            "title": "Introduction",
                            "content": "Summary of Introduction"
                        }},
                        {{
                            "id": "1.1",
                            "title": "Background",
                            "content": "Details about background"
                        }}
                    ]
                }}
        ---

        已有的结构化总结（JSON数组）是：
        {previous_summary_text}

        本次新增的会议内容是：
        {memory}

        请根据以上信息，输出更新后的完整结构化摘要（整个 JSON 数组）。

        
        """

    schema = {
        "type": "json_schema",
        "json_schema": {
            "name": "meeting_summary",
            "strict": True,
            "schema": {
                "type": "object",  # ← root must be object
                "additionalProperties": False,
                "required": ["summary"],
                "properties": {
                    "summary": {
                        "type": "array",  # ← your array here
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                                "content": {"type": "string"},
                            },
                            "required": ["id", "title", "content"],
                            "additionalProperties": False,
                        },
                    }
                },
            },
        },
    }

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            response_format=schema,
        )

        raw_json_content = response.choices[0].message.content

        try:
            structured_list = json.loads(raw_json_content)
            # logger.info("[generate_structured_outline] JSON parsed successfully.")
            logger.info(
                "[generate_structured_outline] Structured JSON:\n"
                + json.dumps(structured_list, indent=2, ensure_ascii=False)
            )
        except json.JSONDecodeError as e:
            logger.error(f"[generate_structured_outline] JSON parsing failed: {e}")
            structured_list = []  # fallback，防止前端崩掉

        return {
            "structured": json.dumps(structured_list, ensure_ascii=False),
            "memory": memory,
        }

    except Exception as e:
        logger.exception("[generate_structured_outline] OpenAI API call failed.")
        return {"structured": "[]", "memory": memory}  # fallback成空结构


def build_structured_summary_graph():
    """
    构建 LangGraph 流程：先 segment_blocks，再 generate_structured_outline
    """
    builder = StateGraph(MeetingState)
    builder.add_node("segment_blocks", segment_blocks)
    builder.add_node("generate_structure", generate_structured_outline)

    builder.set_entry_point("segment_blocks")
    builder.add_edge("segment_blocks", "generate_structure")
    builder.add_edge("generate_structure", END)

    return builder.compile()
