import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { useSettingMutable } from '@/sync/storage';
import { Modal } from '@/modal';
import { t } from '@/text';

// [LAW:dataflow-not-control-flow] Each Item renders unconditionally; only the boolean disabled flag
// or "set/not set" subtitle changes from settings values. No conditional render branches that drop
// rows.

export default React.memo(function TtsSettingsScreen() {
    const [ttsEnabled, setTtsEnabled] = useSettingMutable('ttsEnabled');
    const [ttsAutoMode, setTtsAutoMode] = useSettingMutable('ttsAutoMode');
    const [ttsVoiceId, setTtsVoiceId] = useSettingMutable('ttsVoiceId');
    const [ttsElevenLabsApiKey, setTtsElevenLabsApiKey] = useSettingMutable('ttsElevenLabsApiKey');
    const [ttsLlmBaseUrl, setTtsLlmBaseUrl] = useSettingMutable('ttsLlmBaseUrl');
    const [ttsLlmApiKey, setTtsLlmApiKey] = useSettingMutable('ttsLlmApiKey');
    const [ttsLlmModel, setTtsLlmModel] = useSettingMutable('ttsLlmModel');

    const promptString = React.useCallback(async (
        title: string,
        message: string,
        current: string | null,
        placeholder: string,
        secure: boolean,
        apply: (value: string | null) => void,
    ) => {
        const value = await Modal.prompt(title, message, {
            defaultValue: current ?? '',
            placeholder,
            inputType: secure ? 'secure-text' : 'default',
        });
        if (value !== null) {
            const trimmed = value.trim();
            apply(trimmed.length === 0 ? null : trimmed);
        }
    }, []);

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup
                title={t('settingsTts.enabledTitle')}
                footer={t('settingsTts.enabledFooter')}
            >
                <Item
                    title={t('settingsTts.enableLabel')}
                    subtitle={ttsEnabled ? t('settingsTts.enableSubtitleOn') : t('settingsTts.enableSubtitleOff')}
                    icon={<Ionicons name="volume-high-outline" size={29} color="#34C759" />}
                    rightElement={
                        <Switch
                            value={ttsEnabled}
                            onValueChange={setTtsEnabled}
                        />
                    }
                />
                <Item
                    title={t('settingsTts.autoModeLabel')}
                    subtitle={t('settingsTts.autoModeSubtitle')}
                    subtitleLines={0}
                    icon={<Ionicons name="play-circle-outline" size={29} color="#007AFF" />}
                    disabled={!ttsEnabled}
                    rightElement={
                        <Switch
                            value={ttsAutoMode}
                            onValueChange={setTtsAutoMode}
                            disabled={!ttsEnabled}
                        />
                    }
                />
            </ItemGroup>

            <ItemGroup
                title={t('settingsTts.elevenLabsTitle')}
                footer={t('settingsTts.elevenLabsFooter')}
            >
                <Item
                    title={t('settingsTts.voiceIdLabel')}
                    subtitle={ttsVoiceId ?? t('settingsTts.voiceIdSubtitleNotSet')}
                    icon={<Ionicons name="person-outline" size={29} color="#AF52DE" />}
                    onPress={() => promptString(
                        t('settingsTts.voiceIdLabel'),
                        t('settingsTts.voiceIdPrompt'),
                        ttsVoiceId,
                        t('settingsTts.voiceIdPlaceholder'),
                        false,
                        setTtsVoiceId,
                    )}
                />
                <Item
                    title={t('settingsTts.elevenLabsKeyLabel')}
                    subtitle={ttsElevenLabsApiKey
                        ? t('settingsTts.elevenLabsKeySubtitleSet')
                        : t('settingsTts.elevenLabsKeySubtitleNotSet')}
                    icon={<Ionicons name="key-outline" size={29} color="#FF9500" />}
                    onPress={() => promptString(
                        t('settingsTts.elevenLabsKeyLabel'),
                        t('settingsTts.elevenLabsKeyPrompt'),
                        ttsElevenLabsApiKey,
                        t('settingsTts.elevenLabsKeyPlaceholder'),
                        true,
                        setTtsElevenLabsApiKey,
                    )}
                />
            </ItemGroup>

            <ItemGroup
                title={t('settingsTts.llmTitle')}
                footer={t('settingsTts.llmFooter')}
            >
                <Item
                    title={t('settingsTts.llmBaseUrlLabel')}
                    subtitle={ttsLlmBaseUrl ?? t('settingsTts.llmBaseUrlSubtitleNotSet')}
                    icon={<Ionicons name="link-outline" size={29} color="#5856D6" />}
                    onPress={() => promptString(
                        t('settingsTts.llmBaseUrlLabel'),
                        t('settingsTts.llmBaseUrlPrompt'),
                        ttsLlmBaseUrl,
                        t('settingsTts.llmBaseUrlPlaceholder'),
                        false,
                        setTtsLlmBaseUrl,
                    )}
                />
                <Item
                    title={t('settingsTts.llmKeyLabel')}
                    subtitle={ttsLlmApiKey
                        ? t('settingsTts.llmKeySubtitleSet')
                        : t('settingsTts.llmKeySubtitleNotSet')}
                    icon={<Ionicons name="lock-closed-outline" size={29} color="#FF9500" />}
                    onPress={() => promptString(
                        t('settingsTts.llmKeyLabel'),
                        t('settingsTts.llmKeyPrompt'),
                        ttsLlmApiKey,
                        t('settingsTts.llmKeyPlaceholder'),
                        true,
                        setTtsLlmApiKey,
                    )}
                />
                <Item
                    title={t('settingsTts.llmModelLabel')}
                    subtitle={ttsLlmModel ?? t('settingsTts.llmModelSubtitleNotSet')}
                    icon={<Ionicons name="cube-outline" size={29} color="#5AC8FA" />}
                    onPress={() => promptString(
                        t('settingsTts.llmModelLabel'),
                        t('settingsTts.llmModelPrompt'),
                        ttsLlmModel,
                        t('settingsTts.llmModelPlaceholder'),
                        false,
                        setTtsLlmModel,
                    )}
                />
            </ItemGroup>

            <ItemGroup title={t('settingsTts.privacyTitle')}>
                <Item
                    title={t('settingsTts.privacyTitle')}
                    subtitle={t('settingsTts.privacyText')}
                    subtitleLines={0}
                    icon={<Ionicons name="shield-checkmark-outline" size={29} color="#34C759" />}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
});
