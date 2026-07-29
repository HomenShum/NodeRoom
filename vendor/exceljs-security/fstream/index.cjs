"use strict";

class UnsupportedFstreamOperation {
  constructor() {
    throw new Error(
      "fstream extraction is unavailable: NodeRoom permits ExcelJS streaming parse only",
    );
  }
}

module.exports = UnsupportedFstreamOperation;
module.exports.Reader = UnsupportedFstreamOperation;
module.exports.Writer = UnsupportedFstreamOperation;
