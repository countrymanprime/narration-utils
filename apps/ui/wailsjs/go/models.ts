export namespace main {
	
	export class LineIdentityStampRow {
	    itemGuid: string;
	    lineId: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new LineIdentityStampRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.itemGuid = source["itemGuid"];
	        this.lineId = source["lineId"];
	        this.text = source["text"];
	    }
	}

}

