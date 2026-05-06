import * as React from 'react';
import { Text, TextInput, Platform, View, NativeSyntheticEvent, TextInputKeyPressEventData, TextInputSelectionChangeEventData } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import * as FileSystem from 'expo-file-system';

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
    editable?: boolean;
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
     * iOS 16+ surfaces image paste events through TextInput.onPaste with file:// URIs.
     * We read each pasted file as base64 and report it. Android's TextInput.onPaste only
     * fires for text, so this is iOS-only in practice — Android paste is exposed via the
     * attach button in AgentInput.
     */
    onPasteImages?: (images: PastedImage[]) => void;
}

const SUPPORTED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const MultiTextInput = React.forwardRef<MultiTextInputHandle, MultiTextInputProps>((props, ref) => {
    const {
        value,
        onChangeText,
        placeholder,
        editable = true,
        maxHeight = 120,
        lineHeight = MULTI_TEXT_INPUT_LINE_HEIGHT,
        onKeyPress,
        onSelectionChange,
        onStateChange,
        onPasteImages,
    } = props;

    const { theme } = useUnistyles();
    // Track latest selection in a ref
    const selectionRef = React.useRef({ start: 0, end: 0 });
    const inputRef = React.useRef<TextInput>(null);
    const textStyle = {
        width: '100%' as const,
        fontSize: MULTI_TEXT_INPUT_FONT_SIZE,
        lineHeight,
        maxHeight,
        color: theme.colors.input.text,
        textAlignVertical: 'top' as const,
        padding: 0,
        paddingTop: props.paddingTop,
        paddingBottom: props.paddingBottom,
        paddingLeft: props.paddingLeft,
        paddingRight: props.paddingRight,
        opacity: editable ? 1 : 0.58,
        ...Typography.default(),
    };

    React.useEffect(() => {
        if (!editable) {
            inputRef.current?.blur();
        }
    }, [editable]);

    const handleKeyPress = React.useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (!editable || !onKeyPress) return;

        const nativeEvent = e.nativeEvent;
        const key = nativeEvent.key;
        
        // Map native key names to our normalized format
        let normalizedKey: SupportedKey | null = null;
        
        switch (key) {
            case 'Enter':
                normalizedKey = 'Enter';
                break;
            case 'Escape':
                normalizedKey = 'Escape';
                break;
            case 'ArrowUp':
            case 'Up': // iOS may use different names
                normalizedKey = 'ArrowUp';
                break;
            case 'ArrowDown':
            case 'Down':
                normalizedKey = 'ArrowDown';
                break;
            case 'ArrowLeft':
            case 'Left':
                normalizedKey = 'ArrowLeft';
                break;
            case 'ArrowRight':
            case 'Right':
                normalizedKey = 'ArrowRight';
                break;
            case 'Tab':
                normalizedKey = 'Tab';
                break;
        }

        if (normalizedKey) {
            const keyEvent: KeyPressEvent = {
                key: normalizedKey,
                shiftKey: (nativeEvent as any).shiftKey || false
            };
            
            const handled = onKeyPress(keyEvent);
            if (handled) {
                e.preventDefault();
            }
        }
    }, [editable, onKeyPress]);

    const handleTextChange = React.useCallback((text: string) => {
        // When text changes, assume cursor moves to end
        const selection = { start: text.length, end: text.length };
        selectionRef.current = selection;

        onChangeText(text);
        
        if (onStateChange) {
            onStateChange({ text, selection });
        }
        if (onSelectionChange) {
            onSelectionChange(selection);
        }
    }, [onChangeText, onStateChange, onSelectionChange]);

    // [LAW:dataflow-not-control-flow] iOS pastes always emit through onPaste; we just check
    // each item for an image MIME and read its bytes. Text-only pastes still flow through
    // onChangeText normally — the native side handles the text-paste path itself.
    const handleNativePaste = React.useCallback(async (
        e: NativeSyntheticEvent<{ items?: Array<{ type?: string; data?: string }> }>
    ) => {
        if (!onPasteImages) return;
        const items = e.nativeEvent?.items ?? [];
        const imageItems = items.filter(
            (it) => typeof it.type === 'string' && SUPPORTED_IMAGE_MIME.has(it.type)
        );
        if (imageItems.length === 0) return;

        const collected: PastedImage[] = [];
        for (const item of imageItems) {
            if (!item.data) continue;
            const mime = item.type as PastedImage['mediaType'];
            // iOS surfaces either a file:// URI or raw base64 (varies by RN version + UTI).
            // file:// URIs require expo-file-system to read; base64 strings can be used directly.
            if (item.data.startsWith('file://') || item.data.startsWith('/')) {
                try {
                    const fileUri = item.data.startsWith('file://') ? item.data : `file://${item.data}`;
                    const base64 = await FileSystem.readAsStringAsync(fileUri, {
                        encoding: 'base64' as any,
                    });
                    collected.push({
                        mediaType: mime,
                        data: base64,
                        previewUri: `data:${mime};base64,${base64}`,
                    });
                } catch (err) {
                    console.warn('[MultiTextInput] failed to read pasted file', err);
                }
            } else {
                collected.push({
                    mediaType: mime,
                    data: item.data,
                    previewUri: `data:${mime};base64,${item.data}`,
                });
            }
        }
        if (collected.length > 0) {
            onPasteImages(collected);
        }
    }, [onPasteImages]);

    const handleSelectionChange = React.useCallback((e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        if (e.nativeEvent.selection) {
            const { start, end } = e.nativeEvent.selection;
            const selection = { start, end };
            
            // Only update if selection actually changed
            if (selection.start !== selectionRef.current.start || selection.end !== selectionRef.current.end) {
                selectionRef.current = selection;

                if (onSelectionChange) {
                    onSelectionChange(selection);
                }
                if (onStateChange) {
                    onStateChange({ text: value, selection });
                }
            }
        }
    }, [value, onSelectionChange, onStateChange]);

    // Imperative handle for direct control
    React.useImperativeHandle(ref, () => ({
        setTextAndSelection: (text: string, selection: { start: number; end: number }) => {
            if (inputRef.current) {
                // Use setNativeProps for direct manipulation
                inputRef.current.setNativeProps({
                    text: text,
                    selection: selection
                });
                
                // Update our ref
                selectionRef.current = selection;
                
                // Notify through callbacks
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
            inputRef.current?.focus();
        },
        blur: () => {
            inputRef.current?.blur();
        }
    }), [onChangeText, onStateChange, onSelectionChange]);

    return (
        <View style={{ width: '100%' }}>
            {editable ? (
                // RN's TextInput type predates iOS 16+ image-paste; the prop is passed through
                // to the native impl at runtime. Cast to any to allow the unrecognized prop.
                <TextInput
                    {...(Platform.OS === 'ios' ? { onPaste: handleNativePaste } : {}) as any}
                    ref={inputRef}
                    style={textStyle}
                    placeholder={placeholder}
                    placeholderTextColor={theme.colors.input.placeholder}
                    value={value}
                    editable={editable}
                    onChangeText={handleTextChange}
                    onKeyPress={handleKeyPress}
                    onSelectionChange={handleSelectionChange}
                    multiline={true}
                    autoCapitalize="sentences"
                    autoCorrect={true}
                    keyboardType="default"
                    returnKeyType="default"
                    autoComplete="off"
                    textContentType="none"
                    submitBehavior="newline"
                />
            ) : (
                <View pointerEvents="none">
                    <Text
                        style={[
                            textStyle,
                            {
                                color: value ? theme.colors.input.text : theme.colors.input.placeholder,
                            },
                        ]}
                    >
                        {value || placeholder || ' '}
                    </Text>
                </View>
            )}
        </View>
    );
});

MultiTextInput.displayName = 'MultiTextInput';
