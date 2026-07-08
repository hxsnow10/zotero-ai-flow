#!/usr/bin/env python
# -*- encoding=utf8
# @author      : xiahong
# @file        : zotero_test.py
# @created     : 2025-03-25 11:41:16

"""
Example:
    python zotero_test.py
"""

import sys
import argparse
import os
import logging


from pyzotero import zotero

"""
zotero_library_id="3160691"

# zot = zotero.Zotero(zotero_library_id, "user", local=True)
zot = zotero.Zotero(library_id='000000', library_type='user', local=True)


logger.info
# 设置日志格式，包含文件名、函数名和行号

"""
from pyzotero import zotero

zot = zotero.Zotero(
    library_id="000000", library_type="user", local=True
)  # local=True for read access to local Zotero
total_items = zot.count_items()
print(f"Total items in library: {total_items}")
items = zot.top(limit=100)
# we've retrieved the latest five top-level items in our library
# we can print each item's item type and ID
for item in items:
    print(f"Item: {item['data']['itemType']} | Key: {item['data']['key']}")
    print(f"{item['data'].get('filename',"")}")
    # print(item['data'])
    children = zot.children(item["key"])

    # print(children[0]["links"]["enclosure"]["href"])
    attachments = [
        child for child in children if child["data"].get("itemType") == "attachment"
    ]
    for attachment in attachments:
        print(attachment["data"].get("contentType"))
        print(attachment["links"])
        if attachment["data"].get("contentType") == "application/pdf":
            # TODO: check here
            print(attachment["links"]["enclosure"]["href"])


def main():
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input_path", default=None, type=str)
    parser.add_argument("--foo", action="store_true")
    args = parser.parse_args()
