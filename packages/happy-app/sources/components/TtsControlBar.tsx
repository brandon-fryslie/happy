import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { useSetting } from '@/sync/storage';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useTtsAutoMode } from '@/hooks/useTtsAutoMode';
import type { TtsPlayer } from '@/hooks/useTtsPlayer';
import { Modal } from '@/modal';
import { t } from '@/text';

// [LAW:dataflow-not-control-flow] One render path; the icon and onPress vary as functions of
// (isLoading, isPlaying), not via separate code branches that mount different components. The
// host bar always renders when ttsEnabled — auto-mode runs alongside as an effect.

export const TtsControlBar = React.memo(function TtsControlBar(props: {
    sessionId: string;
    player: TtsPlayer;
}) {
    const { sessionId, player } = props;
    const ttsEnabled = useSetting('ttsEnabled');

    // Auto-mode mounts unconditionally so the watcher's debounce/cooldown refs survive across
    // the user toggling autoMode without disabling ttsEnabled. The hook itself no-ops when
    // autoMode is false.
    useTtsAutoMode(sessionId, player);

    const [, doPlay] = useHappyAction(async () => {
        await player.play('continue');
    });

    const handleLongPress = React.useCallback(() => {
        Modal.alert(
            t('sessionTts.speak'),
            undefined,
            [
                { text: t('sessionTts.continueOption'), onPress: () => { void player.play('continue').catch(() => { /* surfaced below */ }); } },
                { text: t('sessionTts.fromLastUser'), onPress: () => { void player.play('from-last-user').catch(() => { }); } },
                { text: t('sessionTts.restart'), onPress: () => { void player.play('restart').catch(() => { }); } },
                { text: t('sessionTts.stop'), style: 'cancel' },
            ],
        );
    }, [player]);

    if (!ttsEnabled) return null;

    const onPress = player.isPlaying ? player.stop : doPlay;
    const iconName: keyof typeof Ionicons.glyphMap = player.isPlaying
        ? 'stop-circle-outline'
        : 'volume-high-outline';

    return (
        <View style={styles.container}>
            <Pressable
                style={styles.button}
                onPress={onPress}
                onLongPress={handleLongPress}
                disabled={player.isLoading}
                hitSlop={8}
            >
                {player.isLoading ? (
                    <ActivityIndicator size="small" />
                ) : (
                    <Ionicons name={iconName} size={22} />
                )}
            </Pressable>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    button: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
}));
