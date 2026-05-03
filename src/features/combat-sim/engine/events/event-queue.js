/**
 * EventQueue — simple binary min-heap with linear scan queries.
 *
 * Optimized for the combat sim's access pattern: frequent add/remove (every tick)
 * with rare queries (a few per encounter). The heap typically holds 10-30 events,
 * making linear scans trivially fast and eliminating the overhead of maintaining
 * secondary indexes on every mutation.
 */

/**
 * Binary min-heap with O(log n) removal via position tracking.
 */
class IndexedMinHeap {
    constructor() {
        this.data = [];
    }

    get size() {
        return this.data.length;
    }

    push(event) {
        event._heapIndex = this.data.length;
        this.data.push(event);
        this._siftUp(this.data.length - 1);
    }

    pop() {
        if (this.data.length === 0) return undefined;
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            last._heapIndex = 0;
            this.data[0] = last;
            this._siftDown(0);
        }
        top._heapIndex = -1;
        return top;
    }

    remove(event) {
        const idx = event._heapIndex;
        if (idx === undefined || idx < 0 || idx >= this.data.length || this.data[idx] !== event) {
            return false;
        }

        if (idx === this.data.length - 1) {
            this.data.pop();
            event._heapIndex = -1;
            return true;
        }

        const last = this.data.pop();
        last._heapIndex = idx;
        this.data[idx] = last;
        event._heapIndex = -1;

        this._siftUp(idx);
        this._siftDown(idx);
        return true;
    }

    _siftUp(idx) {
        const data = this.data;
        while (idx > 0) {
            const parent = (idx - 1) >> 1;
            if (data[idx].time >= data[parent].time) break;
            const tmp = data[parent];
            data[parent] = data[idx];
            data[idx] = tmp;
            data[parent]._heapIndex = parent;
            data[idx]._heapIndex = idx;
            idx = parent;
        }
    }

    _siftDown(idx) {
        const data = this.data;
        const len = data.length;
        while (true) {
            let smallest = idx;
            const left = 2 * idx + 1;
            const right = 2 * idx + 2;

            if (left < len && data[left].time < data[smallest].time) smallest = left;
            if (right < len && data[right].time < data[smallest].time) smallest = right;

            if (smallest === idx) break;

            const tmp = data[smallest];
            data[smallest] = data[idx];
            data[idx] = tmp;
            data[smallest]._heapIndex = smallest;
            data[idx]._heapIndex = idx;
            idx = smallest;
        }
    }
}

/**
 * EventQueue with O(log n) add/remove and linear scan queries.
 */
class EventQueue {
    constructor() {
        this.minHeap = new IndexedMinHeap();
    }

    /**
     * Add event to the queue.
     * @param {Object} event
     */
    addEvent(event) {
        this.minHeap.push(event);
    }

    /**
     * Pop the earliest event.
     * @returns {Object|undefined}
     */
    getNextEvent() {
        return this.minHeap.pop();
    }

    /**
     * Check if any event of the given type exists.
     * @param {string} type
     * @returns {boolean}
     */
    containsEventOfType(type) {
        const data = this.minHeap.data;
        for (let i = 0; i < data.length; i++) {
            if (data[i].type === type) return true;
        }
        return false;
    }

    /**
     * Check if an event of the given type and hrid exists.
     * @param {string} type
     * @param {string} hrid
     * @returns {boolean}
     */
    containsEventOfTypeAndHrid(type, hrid) {
        const data = this.minHeap.data;
        for (let i = 0; i < data.length; i++) {
            if (data[i].type === type && data[i].hrid === hrid) return true;
        }
        return false;
    }

    /**
     * Get an event matching type + source.
     * @param {string} type
     * @param {Object} source
     * @returns {Object|null}
     */
    getByTypeAndSource(type, source) {
        const data = this.minHeap.data;
        for (let i = 0; i < data.length; i++) {
            if (data[i].type === type && data[i].source === source) return data[i];
        }
        return null;
    }

    /**
     * Clear all events matching type + source.
     * @param {string} type
     * @param {Object} source
     * @returns {boolean} true if any events were cleared
     */
    clearByTypeAndSource(type, source) {
        let cleared = false;
        const data = this.minHeap.data;
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].type === type && data[i].source === source) {
                this.minHeap.remove(data[i]);
                cleared = true;
            }
        }
        return cleared;
    }

    /**
     * Clear all events matching type + hrid.
     * @param {string} type
     * @param {string} hrid
     * @returns {boolean}
     */
    clearByTypeAndHrid(type, hrid) {
        let cleared = false;
        const data = this.minHeap.data;
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].type === type && data[i].hrid === hrid) {
                this.minHeap.remove(data[i]);
                cleared = true;
            }
        }
        return cleared;
    }

    /**
     * Clear all events for a unit (as source OR target).
     * @param {Object} unit
     */
    clearEventsForUnit(unit) {
        const data = this.minHeap.data;
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].source === unit || data[i].target === unit) {
                this.minHeap.remove(data[i]);
            }
        }
    }

    /**
     * Clear all events of a given type.
     * @param {string} type
     */
    clearEventsOfType(type) {
        const data = this.minHeap.data;
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].type === type) {
                this.minHeap.remove(data[i]);
            }
        }
    }

    /**
     * Clear all events and reset.
     */
    clear() {
        this.minHeap = new IndexedMinHeap();
    }

    /**
     * Generic clearMatching for complex predicates.
     * @param {Function} fn - Predicate
     * @returns {boolean}
     */
    clearMatching(fn) {
        let cleared = false;
        const data = this.minHeap.data;
        for (let i = data.length - 1; i >= 0; i--) {
            if (fn(data[i])) {
                this.minHeap.remove(data[i]);
                cleared = true;
            }
        }
        return cleared;
    }

    /**
     * Generic getMatching for complex predicates.
     * @param {Function} fn - Predicate
     * @returns {Object|null}
     */
    getMatching(fn) {
        const data = this.minHeap.data;
        for (let i = 0; i < data.length; i++) {
            if (fn(data[i])) return data[i];
        }
        return null;
    }
}

export default EventQueue;
