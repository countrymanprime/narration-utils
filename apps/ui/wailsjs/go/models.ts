export namespace liveflags {
	
	export class Flag {
	    kind: string;
	    paragraphId: string;
	    wordStart: number;
	    wordEnd: number;
	    scriptStart: number;
	    scriptEnd: number;
	    heard: string;
	    dismissed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Flag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.paragraphId = source["paragraphId"];
	        this.wordStart = source["wordStart"];
	        this.wordEnd = source["wordEnd"];
	        this.scriptStart = source["scriptStart"];
	        this.scriptEnd = source["scriptEnd"];
	        this.heard = source["heard"];
	        this.dismissed = source["dismissed"];
	    }
	}

}

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

