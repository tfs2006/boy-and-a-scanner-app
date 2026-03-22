export class IdAllocator {
  private cGroup = 100000;
  private cFreq = 100000;
  private fileSlot = 1;

  constructor(existingSlots: number[] = []) {
    if (existingSlots.length > 0) {
      this.fileSlot = Math.max(...existingSlots) + 1;
    }
  }

  nextCGroupId(): number {
    this.cGroup += 1;
    return this.cGroup;
  }

  nextCFreqId(): number {
    this.cFreq += 1;
    return this.cFreq;
  }

  nextFileSlot(): number {
    const out = this.fileSlot;
    this.fileSlot += 1;
    return out;
  }
}
