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

// [LAW:one-type-per-behavior] The three auto-speak rows behave identically — one cutter, three
// cookies. They differ only in the data below, so adding a fourth mode later is a row here rather
// than a fourth copy of the same JSX.
const AUTO_SPEAK_OPTIONS = [
    {
        value: 'off',
        icon: 'close-circle-outline',
        titleKey: 'settingsTts.autoSpeakOffLabel',
        subtitleKey: 'settingsTts.autoSpeakOffSubtitle',
    },
    {
        value: 'foreground',
        icon: 'phone-portrait-outline',
        titleKey: 'settingsTts.autoSpeakForegroundLabel',
        subtitleKey: 'settingsTts.autoSpeakForegroundSubtitle',
    },
    {
        value: 'hands-free',
        icon: 'headset-outline',
        titleKey: 'settingsTts.autoSpeakHandsFreeLabel',
        subtitleKey: 'settingsTts.autoSpeakHandsFreeSubtitle',
    },
] as const;

// [LAW:one-type-per-behavior] Same cutter as the auto-speak rows: the vendors differ only in the
// data below, so a third vendor is a row here rather than another copy of the same JSX.
const PROVIDER_OPTIONS = [
    {
        value: 'elevenlabs',
        icon: 'sparkles-outline',
        titleKey: 'settingsTts.providerElevenLabsLabel',
        subtitleKey: 'settingsTts.providerElevenLabsSubtitle',
    },
    {
        value: 'openai',
        icon: 'cloud-outline',
        titleKey: 'settingsTts.providerOpenAiLabel',
        subtitleKey: 'settingsTts.providerOpenAiSubtitle',
    },
] as const;

export default React.memo(function TtsSettingsScreen() {
    const [ttsEnabled, setTtsEnabled] = useSettingMutable('ttsEnabled');
    const [ttsAutoSpeak, setTtsAutoSpeak] = useSettingMutable('ttsAutoSpeak');
    const [ttsProvider, setTtsProvider] = useSettingMutable('ttsProvider');
    const [ttsVoiceId, setTtsVoiceId] = useSettingMutable('ttsVoiceId');
    const [ttsElevenLabsApiKey, setTtsElevenLabsApiKey] = useSettingMutable('ttsElevenLabsApiKey');
    const [ttsOpenAiVoice, setTtsOpenAiVoice] = useSettingMutable('ttsOpenAiVoice');
    const [ttsOpenAiApiKey, setTtsOpenAiApiKey] = useSettingMutable('ttsOpenAiApiKey');
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
            </ItemGroup>

            <ItemGroup
                title={t('settingsTts.autoSpeakTitle')}
                footer={t('settingsTts.autoSpeakFooter')}
            >
                {AUTO_SPEAK_OPTIONS.map(({ value, icon, titleKey, subtitleKey }) => (
                    <Item
                        key={value}
                        title={t(titleKey)}
                        subtitle={t(subtitleKey)}
                        subtitleLines={0}
                        icon={<Ionicons name={icon} size={29} color="#007AFF" />}
                        disabled={!ttsEnabled}
                        selected={ttsAutoSpeak === value}
                        onPress={() => setTtsAutoSpeak(value)}
                    />
                ))}
            </ItemGroup>

            <ItemGroup
                title={t('settingsTts.providerTitle')}
                footer={t('settingsTts.providerFooter')}
            >
                {PROVIDER_OPTIONS.map(({ value, icon, titleKey, subtitleKey }) => (
                    <Item
                        key={value}
                        title={t(titleKey)}
                        subtitle={t(subtitleKey)}
                        subtitleLines={0}
                        icon={<Ionicons name={icon} size={29} color="#007AFF" />}
                        disabled={!ttsEnabled}
                        selected={ttsProvider === value}
                        onPress={() => setTtsProvider(value)}
                    />
                ))}
            </ItemGroup>

            <ItemGroup
                title={t('settingsTts.openAiTitle')}
                footer={t('settingsTts.openAiFooter')}
            >
                <Item
                    title={t('settingsTts.openAiVoiceLabel')}
                    subtitle={ttsOpenAiVoice ?? t('settingsTts.openAiVoiceSubtitleNotSet')}
                    icon={<Ionicons name="person-outline" size={29} color="#AF52DE" />}
                    onPress={() => promptString(
                        t('settingsTts.openAiVoiceLabel'),
                        t('settingsTts.openAiVoicePrompt'),
                        ttsOpenAiVoice,
                        t('settingsTts.openAiVoicePlaceholder'),
                        false,
                        setTtsOpenAiVoice,
                    )}
                />
                <Item
                    title={t('settingsTts.openAiKeyLabel')}
                    subtitle={ttsOpenAiApiKey
                        ? t('settingsTts.openAiKeySubtitleSet')
                        : t('settingsTts.openAiKeySubtitleNotSet')}
                    icon={<Ionicons name="key-outline" size={29} color="#FF9500" />}
                    onPress={() => promptString(
                        t('settingsTts.openAiKeyLabel'),
                        t('settingsTts.openAiKeyPrompt'),
                        ttsOpenAiApiKey,
                        t('settingsTts.openAiKeyPlaceholder'),
                        true,
                        setTtsOpenAiApiKey,
                    )}
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
