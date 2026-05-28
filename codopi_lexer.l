%option noyywrap yylineno

%{
#include "parser.tab.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <io.h>
#define isatty _isatty
#else
#include <unistd.h>
#endif

extern int errorCount;

static char* copyText(const char* text) {
    char* copy = (char*)malloc(strlen(text) + 1);
    strcpy(copy, text);
    return copy;
}
%}

%%

"let"       { return LET; }
"print"     { return PRINT; }
"if"        { return IF; }
"else"      { return ELSE; }
"while"     { return WHILE; }

"=="        { return EQ; }
"!="        { return NE; }
"<="        { return LE; }
">="        { return GE; }

"//".*      { /* ignore single-line comment */ }

[0-9]+ {
    yylval.str = copyText(yytext);
    return NUMBER;
}

[a-zA-Z_][a-zA-Z0-9_]* {
    yylval.str = copyText(yytext);
    return ID;
}

[+\-*/=;(){}<>] {
    return yytext[0];
}

[ \t\r\n]+ {
    /* ignore whitespace */
}

. {
    fprintf(stderr, "Lexical Error at line %d: unknown character '%s'\n", yylineno, yytext);
    errorCount++;
}

%%