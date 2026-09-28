export type DataSourcePayload = {
	event: string;
	items: DataSourceResult;
};

export type DataSourceResult = DataSourceResultItem[];

export type DataSourceResultItem = {
	disabled?: boolean;
	label: string;
	value: string;
};
