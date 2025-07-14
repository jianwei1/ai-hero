import ReactMarkdown, { type Components } from "react-markdown";
import type { Message } from "ai";
import { Terminal } from "lucide-react";

export type MessagePart = NonNullable<
  Message["parts"]
>[number];

interface ChatMessageProps {
  message: Message;
  userName: string;
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const stateBadge = (state: string) => {
  let color = "bg-blue-500 text-white";
  let label = "Calling";
  if (state === "call") {
    color = "bg-gray-500 text-white";
    label = "Called";
  } else if (state === "result") {
    color = "bg-green-600 text-white";
    label = "Completed";
  }
  return (
    <span
      className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${color}`}
      aria-label={`Tool state: ${label}`}
    >
      {label}
    </span>
  );
};

const ToolInvocationPart = ({ part }: { part: MessagePart }) => {
  if (part.type !== "tool-invocation") return null;

  const { toolInvocation } = part;
  const { state, toolName, args } = toolInvocation;

  return (
    <div
      className="relative mb-4 flex rounded-lg border border-gray-700 bg-gray-800 shadow-lg"
      aria-label="Tool invocation"
      role="region"
    >
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 h-full w-1 rounded-l bg-blue-500" aria-hidden="true" />
      <div className="flex flex-col gap-2 p-4 pl-6 w-full">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <Terminal className="size-5 text-blue-500" aria-label="Tool call" />
          <span className="font-bold text-gray-100 text-sm" aria-label="Tool name">
            {toolName}
          </span>
          {stateBadge(state)}
        </div>
        {/* Arguments */}
        <div>
          <div className="text-xs font-semibold text-gray-400 mb-1">Arguments</div>
          <pre className="text-xs bg-gray-900 rounded p-2 overflow-x-auto font-mono text-gray-200 border border-gray-700" aria-label="Tool arguments">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>
        {/* Result */}
        {state === "result" && "result" in toolInvocation && (
          <div>
            <div className="text-xs font-semibold text-gray-400 mb-1 mt-2">Result</div>
            <pre className="text-xs bg-gray-900 rounded p-2 overflow-x-auto font-mono text-green-200 border border-green-700" aria-label="Tool result">
              {JSON.stringify(toolInvocation.result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

const TextPart = ({ part }: { part: MessagePart }) => {
  if (part.type !== "text") return null;

  return (
    <div className="prose prose-invert max-w-none">
      <Markdown>{part.text}</Markdown>
    </div>
  );
};

const MessagePartRenderer = ({ part }: { part: MessagePart }) => {
  switch (part.type) {
    case "text":
      return <TextPart part={part} />;
    case "tool-invocation":
      return <ToolInvocationPart part={part} />;
    default:
      return null;
  }
};

export const ChatMessage = ({ message, userName }: ChatMessageProps) => {
  const isAI = message.role === "assistant";

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        {message.parts?.map((part, index) => (
          <MessagePartRenderer key={index} part={part} />
        ))}
      </div>
    </div>
  );
};
