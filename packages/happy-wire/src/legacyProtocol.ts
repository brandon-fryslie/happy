import * as z from 'zod';
import { MessageMetaSchema } from './messageMeta';

// [LAW:one-source-of-truth] Mirror Anthropic ContentBlockParam shape so the CLI can pass
// content arrays straight to the Claude SDK (`query`) without translation.
export const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
export type TextBlock = z.infer<typeof TextBlockSchema>;

export const ImageMediaTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
export type ImageMediaType = z.infer<typeof ImageMediaTypeSchema>;

export const ImageBlockSchema = z.object({
  type: z.literal('image'),
  source: z.object({
    type: z.literal('base64'),
    media_type: ImageMediaTypeSchema,
    data: z.string(),
  }),
});
export type ImageBlock = z.infer<typeof ImageBlockSchema>;

export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  ImageBlockSchema,
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// [LAW:locality-or-seam] Legacy `{type:'text',text}` object kept as a sibling of the new
// block-array shape so existing senders (older app/CLI versions) keep validating against
// this schema. New senders include image content by sending an array.
export const UserMessageSchema = z.object({
  role: z.literal('user'),
  content: z.union([
    z.object({
      type: z.literal('text'),
      text: z.string(),
    }),
    z.array(ContentBlockSchema),
  ]),
  localKey: z.string().optional(),
  meta: MessageMetaSchema.optional(),
});
export type UserMessage = z.infer<typeof UserMessageSchema>;

export const AgentMessageSchema = z.object({
  role: z.literal('agent'),
  content: z
    .object({
      type: z.string(),
    })
    .passthrough(),
  meta: MessageMetaSchema.optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const LegacyMessageContentSchema = z.discriminatedUnion('role', [UserMessageSchema, AgentMessageSchema]);
export type LegacyMessageContent = z.infer<typeof LegacyMessageContentSchema>;
