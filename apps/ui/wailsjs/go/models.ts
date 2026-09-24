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
	
	export class FindingsQuery {
	    analyzer?: string;
	    category?: string;
	    severity?: string;
	    status?: string;
	    chapterId?: string;
	    minConfidence?: number;
	    includeNotInLatestRun?: boolean;
	    sort?: string;
	    descending?: boolean;
	    limit?: number;
	    offset?: number;
	
	    static createFrom(source: any = {}) {
	        return new FindingsQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.analyzer = source["analyzer"];
	        this.category = source["category"];
	        this.severity = source["severity"];
	        this.status = source["status"];
	        this.chapterId = source["chapterId"];
	        this.minConfidence = source["minConfidence"];
	        this.includeNotInLatestRun = source["includeNotInLatestRun"];
	        this.sort = source["sort"];
	        this.descending = source["descending"];
	        this.limit = source["limit"];
	        this.offset = source["offset"];
	    }
	}
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
	export class TakeReviewScanScope {
	    chapterTrackName: string;
	    pickupTrackName?: string;
	    pickupRangeStart?: number;
	    pickupRangeEnd?: number;
	
	    static createFrom(source: any = {}) {
	        return new TakeReviewScanScope(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chapterTrackName = source["chapterTrackName"];
	        this.pickupTrackName = source["pickupTrackName"];
	        this.pickupRangeStart = source["pickupRangeStart"];
	        this.pickupRangeEnd = source["pickupRangeEnd"];
	    }
	}

}

