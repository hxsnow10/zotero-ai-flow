#!/usr/bin/env sh

######################################################################
# @author      : xiahong (xiahahaha01@gmail.com)
# @file        : format
# @created     : Sunday Jul 05, 2026 13:30:29 CST
#
# @description : 
######################################################################

black . 
npx prettier --write "**/*.js"
