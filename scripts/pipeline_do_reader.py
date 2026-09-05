#!/usr/bin/env python3
"""Retired legacy reader.

Historical ingestion is copy-first. Use ``npm run mariadb:collect`` followed by
``npm run mariadb:import-raw``. This module intentionally refuses execution so
the old newest-100/normalize-immediately path cannot be started accidentally.
"""


def fetch_and_enqueue_source_messages(batch_size=100):
    del batch_size
    raise RuntimeError(
        "pipeline_do_reader.py is retired: use the checkpointed copy-first "
        "mariadb:collect and mariadb:import-raw commands"
    )


if __name__ == "__main__":
    fetch_and_enqueue_source_messages()
