/** Map initialization lifecycle states. Mirrors `InitState` from `MapViewState.kt`. */
export enum InitState {
    NotStarted = 'NotStarted',
    Initializing = 'Initializing',
    SdkInitialized = 'SdkInitialized',
    MapViewCreated = 'MapViewCreated',
    MapCreating = 'MapCreating',
    MapCreated = 'MapCreated',
    MapLoaded = 'MapLoaded',
    Failed = 'Failed',
}
