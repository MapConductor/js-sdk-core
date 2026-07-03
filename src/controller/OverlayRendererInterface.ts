export interface ChangeParamsInterface<EntityType> {
    readonly current: EntityType;
    readonly prev: EntityType;
}

export interface OverlayRendererInterface<ActualType, StateType, EntityType> {
    onAdd(data: StateType[]): Promise<Array<ActualType | null>> | Array<ActualType | null>;

    onChange(
        data: Array<ChangeParamsInterface<EntityType>>,
    ): Promise<Array<ActualType | null>> | Array<ActualType | null>;

    onRemove(data: EntityType[]): Promise<void> | void;

    onPostProcess(): Promise<void> | void;
}
