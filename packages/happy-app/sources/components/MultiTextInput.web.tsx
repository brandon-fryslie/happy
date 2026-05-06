import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import TextareaAutosize from 'react-textarea-autosize';
import { Typography } from '@/constants/Typography';

export type SupportedKey = 'Enter' | 'Escape' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Tab';

export interface KeyPressEvent {
    key: SupportedKey;
    shiftKey: boolean;
}

export type OnKeyPressCallback = (event: KeyPressEvent) => boolean;

export const MULTI_TEXT_INPUT_FONT_SIZE = 16;
export const MULTI_TEXT_INPUT_LINE_HEIGHT = 22;

export interface TextInputState {
    text: string;
    selection: {
        start: number;
        end: number;
    };
}

export interface MultiTextInputHandle {
    setTextAndSelection: (text: string, selection: { start: number; end: number }) => void;
    focus: () => void;
    blur: () => void;
}

export type PastedImage = {
    mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    /** Raw base64 (no data: URI prefix). */
    data: string;
    /** data: URI suitable for previewing in <Image source={{uri}} />. */
    previewUri: string;
};

interface MultiTextInputProps {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    maxHeight?: number;
    lineHeight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    onKeyPress?: OnKeyPressCallback;
    onSelectionChange?: (selection: { start: number; end: number }) => void;
    onStateChange?: (state: TextInputState) => void;
    /**
     * Called when the user pastes one or more images. The component reads the bytes
     * via FileReader before invoking this; callers don't see raw clipboard items.
     * If the paste contained no images, this is not called and text-paste proceeds normally.
     */
    onPasteImages?: (images: PastedImage[]) => void;
}

export const MultiTextInput = React.forwardRef<MultiTextInputHandle, MultiTextInputProps>((props, ref) => {
    const {
        value,
        onChangeText,
        placeholder,
        maxHeight = 120,
        lineHeight = MULTI_TEXT_INPUT_LINE_HEIGHT,
        onKeyPress,
        onSelectionChange,
        onStateChange,
        onPasteImages
    } = props;
    
    const { theme } = useUnistyles();
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    const maxRows = Math.floor(maxHeight / lineHeight);

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!onKeyPress) return;

        const isComposing = e.nativeEvent.isComposing || (e.nativeEvent as any).isComposing || e.keyCode === 229;
        if (isComposing) {
            return;
        }

        const key = e.key;
        
        // Map browser key names to our normalized format
        let normalizedKey: SupportedKey | null = null;
        
        switch (key) {
            case 'Enter':
                normalizedKey = 'Enter';
                break;
            case 'Escape':
                normalizedKey = 'Escape';
                break;
            case 'ArrowUp':
                normalizedKey = 'ArrowUp';
                break;
            case 'ArrowDown':
                normalizedKey = 'ArrowDown';
                break;
            case 'ArrowLeft':
                normalizedKey = 'ArrowLeft';
                break;
            case 'ArrowRight':
                normalizedKey = 'ArrowRight';
                break;
            case 'Tab':
                normalizedKey = 'Tab';
                break;
        }

        if (normalizedKey) {
            const keyEvent: KeyPressEvent = {
                key: normalizedKey,
                shiftKey: e.shiftKey
            };
            
            const handled = onKeyPress(keyEvent);
            if (handled) {
                e.preventDefault();
            }
        }
    }, [onKeyPress]);

    const handleChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        const selection = { 
            start: e.target.selectionStart, 
            end: e.target.selectionEnd 
        };
        
        onChangeText(text);
        
        if (onStateChange) {
            onStateChange({ text, selection });
        }
        if (onSelectionChange) {
            onSelectionChange(selection);
        }
    }, [onChangeText, onStateChange, onSelectionChange]);

    // [LAW:dataflow-not-control-flow] Always inspect the clipboard items; if any are images
    // we extract them as base64 and report. Text-only pastes fall through to the browser's
    // default insertion. We only preventDefault when we actually consumed images.
    const handlePaste = React.useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (!onPasteImages) return;

        const items = Array.from(e.clipboardData?.items ?? []);
        const imageItems = items.filter(
            (it) => it.kind === 'file' && /^image\/(png|jpeg|gif|webp)$/.test(it.type)
        );
        if (imageItems.length === 0) return;

        e.preventDefault();
        const readers: Promise<PastedImage | null>[] = imageItems.map(async (item): Promise<PastedImage | null> => {
            const file = item.getAsFile();
            if (!file) return null;
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(reader.error ?? new Error('clipboard read failed'));
                reader.onload = () => resolve(String(reader.result));
                reader.readAsDataURL(file);
            });
            // dataUrl shape: data:<mime>;base64,<data>
            const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
            if (!match) return null;
            const mime = match[1];
            const data = match[2];
            if (
                mime !== 'image/png' &&
                mime !== 'image/jpeg' &&
                mime !== 'image/gif' &&
                mime !== 'image/webp'
            ) {
                return null;
            }
            return { mediaType: mime, data, previewUri: dataUrl };
        });

        Promise.all(readers).then((results) => {
            const images = results.filter((r): r is PastedImage => r !== null);
            if (images.length > 0) {
                onPasteImages(images);
            }
        });
    }, [onPasteImages]);

    const handleSelect = React.useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement;
        const selection = { 
            start: target.selectionStart, 
            end: target.selectionEnd 
        };
        
        if (onSelectionChange) {
            onSelectionChange(selection);
        }
        if (onStateChange) {
            onStateChange({ text: value, selection });
        }
    }, [value, onSelectionChange, onStateChange]);

    // Imperative handle for direct control
    React.useImperativeHandle(ref, () => ({
        setTextAndSelection: (text: string, selection: { start: number; end: number }) => {
            if (textareaRef.current) {
                // Directly set value and selection on DOM element
                textareaRef.current.value = text;
                textareaRef.current.setSelectionRange(selection.start, selection.end);
                
                // Trigger React's onChange by dispatching an input event
                const event = new Event('input', { bubbles: true });
                textareaRef.current.dispatchEvent(event);
                
                // Also call callbacks directly for immediate update
                onChangeText(text);
                if (onStateChange) {
                    onStateChange({ text, selection });
                }
                if (onSelectionChange) {
                    onSelectionChange(selection);
                }
            }
        },
        focus: () => {
            textareaRef.current?.focus();
        },
        blur: () => {
            textareaRef.current?.blur();
        }
    }), [onChangeText, onStateChange, onSelectionChange]);

    return (
        <View style={{ width: '100%' }}>
            <TextareaAutosize
                ref={textareaRef}
                style={{
                    width: '100%',
                    padding: '0',
                    fontSize: `${MULTI_TEXT_INPUT_FONT_SIZE}px`,
                    color: theme.colors.input.text,
                    border: 'none',
                    outline: 'none',
                    resize: 'none' as const,
                    backgroundColor: 'transparent',
                    fontFamily: Typography.default().fontFamily,
                    lineHeight: `${lineHeight}px`,
                    scrollbarWidth: 'none',
                    paddingTop: props.paddingTop,
                    paddingBottom: props.paddingBottom,
                    paddingLeft: props.paddingLeft,
                    paddingRight: props.paddingRight,
                }}
                placeholder={placeholder}
                value={value}
                onChange={handleChange}
                onSelect={handleSelect}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                maxRows={maxRows}
                autoCapitalize="sentences"
                autoCorrect="on"
                autoComplete="off"
            />
        </View>
    );
});

MultiTextInput.displayName = 'MultiTextInput';
