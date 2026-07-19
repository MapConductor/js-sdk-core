

export const MarkerIconSize = Object.freeze({
    Small: 32,
    Regular: 48,
    Large: 60,
});

export const Settings = Object.freeze({
    Default : Object.freeze({
        tapTolerance: 28,
        markerDropAnimateDuration: 300,
        markerBounceAnimateDuration: 2000,
        iconSize: MarkerIconSize.Regular,
        iconStroke: 1,
        composeEventDebounce: 5,
    }),
});