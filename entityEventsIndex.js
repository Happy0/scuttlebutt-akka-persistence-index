const FlumeviewLevel = require('flumeview-level');
const pull = require('pull-stream');

const window = require('pull-window');

module.exports = (sbot, myKey) => {

    const version = 2;

    const index = sbot._flumeUse('entity-events-index', FlumeviewLevel(version, mapFunction));

    function mapFunction(message) {

        if (isPersistenceMessage(message)) {

            const author = message.value.author;
            const persistenceId = message.value.content.persistenceId;
            const sequenceNr = message.value.content.sequenceNr;
            
            const part = message.value.content.part || 1;

            return [[author, persistenceId, sequenceNr, part]];
        } else {
            return [];
        }
    }

    function isPersistenceMessage(message) {
        const type = message.value.content.type;
        return type === "akka-persistence-message";
    }

    function eventsByPersistenceId(authorId, persistenceId, fromSequenceNumber, toSequenceNumber) {
        const source = index.read({
            keys: true,
            gte: [authorId, persistenceId, fromSequenceNumber, null],
            lte: [authorId, persistenceId, toSequenceNumber, undefined]
        });

        return pull(source, pull.map(msg => {
            return msg.value.value.content
        }), reAssemblePartsThrough());
    }

    function reAssemblePartsThrough() {

        let windowing = false;

        return window(function(_, cb) {

            if (windowing) return;
            windowing = true;

            let parts = [];

            return function (end, data) {
                
                if (!data.part) { 
                    cb(null, data);
                    windowing = false;
                }
                else if (end && parts.length > 0) return cb(null, assembleParts(parts));
                else if (end) return cb(null, data);
                else if (data.part === data.of) {
                    windowing = false;
                    parts.push(data);
                    cb(null, assembleParts(parts))
                }
                else {
                    parts.push(data);
                }
            }
        }, function( start, data) {
            return data;
        });
    }

    function assembleParts(parts) {

        const payloads = parts.map(part => part.payload);

        const fullPayload = payloads.join('');

        const full = parts[0];
        
        if (full.encrypted) {
            // Encrypted payloads are base64 strings until they're decrypted later in the
            // pipeline
            full.payload = fullPayload;
        } else {
            // Make it into an object again now that the string is joined up.
            full.payload = JSON.parse(fullPayload);
        }
        
        return full;
    }

    function highestSequenceNumber(authorId, persistenceId, cb) {

        const source = eventsByPersistenceId(authorId, persistenceId, 0, undefined);

        pull(source, pull.collect( (err, result) => {
        
            if (err) {
                cb(err);
            } else if (result.length === 0) {
                cb(null, 0);
            } else {
                const lastItem = result[result.length - 1];

                cb(null, lastItem.sequenceNr);
            }
        }));
    }

    return {
        eventsByPersistenceId,
        highestSequenceNumber
    }

}